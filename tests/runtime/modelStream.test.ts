import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { sendChat } from "../../packages/runtime/src/model.js";
import { modelConfig } from "../../packages/runtime/src/lib/modelConfig.js";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler;
let lastRequestBody = "";

const sse = (events: string[]): string =>
    events.map((event) => `data: ${event}\n\n`).join("");

describe("model provider streaming client", () => {
    beforeAll(async () => {
        server = http.createServer((req, res) => {
            let body = "";
            req.on("data", (chunk) => {
                body += chunk;
            });
            req.on("end", () => {
                lastRequestBody = body;
                handler(req, res);
            });
        });
        await new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", () => resolve()),
        );
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        server.closeAllConnections?.();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    afterEach(() => {
        lastRequestBody = "";
    });

    it("requests a streamed completion and assembles the final message", async () => {
        // The configured chat model (CHAT_MODEL env / default) is what the
        // runtime puts on every provider request.
        expect(modelConfig.model).toBe("qwen3:8b");

        handler = (_req, res) => {
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            res.write(
                sse([
                    '{"choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}',
                    '{"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}',
                    "[DONE]",
                ]),
            );
            res.end();
        };

        const data = await sendChat(
            { messages: [{ role: "user", content: "Hi" }] },
            { baseUrl },
        );

        expect(data.choices?.[0]?.message?.content).toBe("Hello");
        expect(data.choices?.[0]?.finish_reason).toBe("stop");

        const request = JSON.parse(lastRequestBody) as {
            stream?: boolean;
            model?: string;
        };
        expect(request.stream).toBe(true);
        expect(request.model).toBe("qwen3:8b");
    });

    it("reassembles tool call arguments split across chunks", async () => {
        handler = (_req, res) => {
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            res.write(
                sse([
                    '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"run_command","arguments":""}}]},"finish_reason":null}]}',
                    '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"comm"}}]},"finish_reason":null}]}',
                    '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"and\\":\\"ls\\"}"}}]},"finish_reason":"tool_calls"}]}',
                    "[DONE]",
                ]),
            );
            res.end();
        };

        const data = await sendChat(
            { messages: [{ role: "user", content: "Run ls" }] },
            { baseUrl },
        );

        const toolCalls = data.choices?.[0]?.message?.tool_calls;
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls?.[0]?.id).toBe("call-1");
        expect(toolCalls?.[0]?.function?.name).toBe("run_command");
        expect(toolCalls?.[0]?.function?.arguments).toBe('{"command":"ls"}');
        expect(data.choices?.[0]?.finish_reason).toBe("tool_calls");
    });

    it("generates unique fallback ids when the provider omits them across responses", async () => {
        // Two streamed responses, each with one id-less tool call. A fixed
        // `call-0` fallback would collide across responses, letting results
        // attach to the wrong call in the conversation.
        const idLessCall = (name: string): string =>
            `{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"${name}","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}`;
        handler = (_req, res) => {
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            res.write(sse([idLessCall("run_command"), "[DONE]"]));
            res.end();
        };

        const first = await sendChat(
            { messages: [{ role: "user", content: "Run ls" }] },
            { baseUrl },
        );
        const second = await sendChat(
            { messages: [{ role: "user", content: "Run pwd" }] },
            { baseUrl },
        );

        const firstId = first.choices?.[0]?.message?.tool_calls?.[0]?.id;
        const secondId = second.choices?.[0]?.message?.tool_calls?.[0]?.id;
        expect(firstId).toBeTruthy();
        expect(secondId).toBeTruthy();
        expect(firstId).not.toBe(secondId);
        expect(firstId).toMatch(/^call-/);
        expect(secondId).toMatch(/^call-/);
    });

    it("times out with a phase-tagged error when the provider never responds", async () => {
        handler = () => {
            // Consume the request but never send a response byte.
        };

        const startedAt = Date.now();
        await expect(
            sendChat({ messages: [{ role: "user", content: "Hi" }] }, {
                baseUrl,
                timeoutMs: 300,
            }),
        ).rejects.toThrow(
            /Model provider request timed out after 300ms \(phase=model_request/,
        );
        expect(Date.now() - startedAt).toBeLessThan(5_000);
    });

    it("reports a clear error when the provider is unreachable", async () => {
        const probe = http.createServer(() => {});
        await new Promise<void>((resolve) =>
            probe.listen(0, "127.0.0.1", () => resolve()),
        );
        const deadPort = (probe.address() as AddressInfo).port;
        await new Promise<void>((resolve) => probe.close(() => resolve()));

        await expect(
            sendChat(
                { messages: [{ role: "user", content: "Hi" }] },
                { baseUrl: `http://127.0.0.1:${deadPort}`, timeoutMs: 2_000 },
            ),
        ).rejects.toThrow(/Model provider unreachable: ECONNREFUSED/);
    });

    it("fails clearly when the stream ends without any data", async () => {
        handler = (_req, res) => {
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            res.end();
        };

        await expect(
            sendChat({ messages: [{ role: "user", content: "Hi" }] }, { baseUrl }),
        ).rejects.toThrow(
            /Model provider stream ended without data \(phase=model_request/,
        );
    });
});
