import type {
    AgentTool,
    AgentEventCallback,
    LoopMessage,
    ModelFn,
    ModelToolCall,
} from "./types.js";
import { recoverTextToolCalls } from "./lib/toolCallRecovery.js";

export const MAX_ITERATIONS = 30;

/**
 * Default ceiling for a single tool execution. Long enough for ordinary
 * GitHub/sandbox operations, short enough that a hung tool cannot stall the
 * run indefinitely. Tools may override via `AgentTool.timeoutMs`
 * (run_command uses a larger budget for builds/tests).
 */
export const DEFAULT_TOOL_TIMEOUT_MS = 120_000;

/**
 * Max corrective retries when the model falsely claims a capability is
 * unavailable while tools ARE registered. Kept small so a stubborn model
 * cannot loop, and independent of the workflow nudge budget.
 */
export const MAX_CAPABILITY_CORRECTIONS = 2;

/**
 * Max nudges after a failed tool call when the model responds with prose
 * instead of retrying with corrected arguments (e.g. it tells the user to
 * check the file themselves after read_file failed on a wrong path). The
 * nudge names the tool that failed and never invents arguments — it only
 * tells the model to act on the error it already received, for that same
 * objective. Bounded like the capability-correction budget so a terminally
 * failing tool cannot loop.
 */
export const MAX_TOOL_RETRY_NUDGES = 1;

/**
 * A model claim that a required tool does not exist / is not available.
 * Conservative: only tool-availability claims, never ordinary answers.
 * Phrasings are drawn from refusals actually observed in production
 * transcripts (e.g. "tools … strictly for GitHub issue and PR
 * operations", "do not include a function for reading files", "none of
 * these tools can …"), so the guard keeps firing as the model rewords
 * the same false claim.
 */
const CAPABILITY_REFUSAL_PATTERNS: RegExp[] = [
    /\bno tool (?:exists|is available|available|to read|to inspect|to access|for reading)\b/i,
    /\b(?:available|registered) tools?\b[^.]{0,80}\b(?:only|merely|just) handle\b/i,
    /\btools? (?:only|merely|just) handle\b/i,
    /\b(?:do not|don't|cannot|can't) have (?:a |any )?(?:file|repository|repo|code|reading|inspection) tool\b/i,
    /\bno (?:file|repository|repo|code) (?:reading|inspection|access|tools?)\b/i,
    /\b(?:cannot|can't|unable to) (?:read|inspect|access|view|list|open) (?:the )?(?:files?|repository|repo|code|readme)\b(?![^.]*\b(?:because|since|as)\b[^.]*\bnot (?:linked|connected|available|selected)\b)/i,
    // Observed: "The tools available to me are strictly for GitHub …",
    // "The provided tools only support GitHub …", "All available
    // functions are limited to GitHub …". Scoped to domain-limitation
    // wording so a success report ("only create_issue was needed") never
    // matches.
    /\b(?:tools|functions|capabilities)\b[^.]{0,80}\b(?:strictly for|exclusively for|limited to|only (?:support|handle|cover|work|provide|manage)|merely (?:support|handle|cover))\b/i,
    // Observed: "The tools provided do not include a function for reading…",
    // "do **not** include any tools for reading repository files".
    /\b(?:do not|don't|does not|doesn't|did not|didn't) include (?:a |any )?(?:functions?|tools?|capabilities?)\b/i,
    // Observed: "I do not have the capability to read files…".
    /\b(?:do not|don't) have the capability to (?:read|inspect|access|view|list|analyze|explain)\b/i,
    // Observed: "…none of these tools can analyze or explain…".
    /\bnone of (?:these|the|those) (?:tools|functions)\b/i,
    // Observed: "…not supported by any of the provided tools."
    /\bnot supported by (?:any of )?(?:the )?(?:provided|available|registered) tools\b/i,
    // Observed: "I cannot fulfill this request with the provided capabilities."
    /\b(?:cannot|can't) (?:fulfill|complete) (?:this|the|your|that) (?:request|task)\b/i,
    // Observed (UI run): "The `read_file` tool is not available in this
    // context." — markdown is stripped before matching.
    /\btool (?:is|are) not available in this (?:context|session|run)\b/i,
    // Observed (UI run): "I can only interact with GitHub repositories
    // using the following functions: …". Scoped to a capability verb plus
    // GitHub/these/the following so permission-style sentences ("I can only
    // use run_command with your approval") never match.
    /\b(?:can|could) only (?:interact|use|access|work) (?:with|via|using|on|through) (?:github|the following|these)\b/i,
    // Observed (UI run): "(the tools listed above handle only GitHub
    // issues/PRs)" and "GitHub functions listed (which handle issue/pr
    // operations only)" — the word "only" can sit anywhere after the
    // tools-lexicon within the sentence, with arbitrary words in between.
    // Scoped to `only` (not "just") so ordinary sentences ("these tools
    // just need permission") stay untouched; a spurious correction is
    // bounded by MAX_CAPABILITY_CORRECTIONS anyway.
    /\b(?:tools|functions|capabilities)\b[^.]{0,120}\bonly\b/i,
];

/**
 * Genuine missing-context answers (no repository linked, no sandbox).
 * These are truthful statements about the execution context, not false
 * capability claims — they must never trigger a corrective retry.
 */
const MISSING_CONTEXT_PATTERNS: RegExp[] = [
    /\bno repository (?:is |has been )?(?:linked|connected|selected|available)\b/i,
    /\b(?:connect|link) (?:a|the|this|another) repository\b/i,
    /\b(?:is not|isn't|not) (?:yet )?(?:linked|connected|selected)\b/i,
    /\bwithout (?:a |the |any )?(?:linked |connected |selected )?repository\b/i,
    /\bno sandbox (?:is )?(?:available|running|linked)\b/i,
];

/**
 * Whether the model is falsely denying a registered capability.
 * Only claims about missing tools qualify; answers about missing
 * repository/sandbox context are excluded so a truthful "no repository
 * is connected" response passes through untouched.
 */
export function isFalseCapabilityRefusal(
    content: string,
    hasRegisteredTools: boolean,
): boolean {
    if (!hasRegisteredTools || content.trim().length === 0) {
        return false;
    }
    // Match against markdown-stripped text so emphasis the model inserts
    // into its refusal ("do **not** include") cannot dodge the patterns.
    const normalized = content.replace(/[`*]/g, "");
    if (MISSING_CONTEXT_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return false;
    }
    return CAPABILITY_REFUSAL_PATTERNS.some((pattern) =>
        pattern.test(normalized),
    );
}

/** Internal signal: a tool exceeded its execution budget. */
class ToolTimeoutError extends Error {
    constructor(toolName: string, timeoutMs: number) {
        super(`${toolName} did not finish within ${timeoutMs}ms`);
        this.name = "ToolTimeoutError";
    }
}

interface ToolExecutionOutcome {
    result: any;
    elapsedMs: number;
    timedOut: boolean;
    failed: boolean;
}

/**
 * Validate a parsed argument object against the tool's JSON schema
 * before execution: every `required` field must be present and each
 * provided value must match its declared primitive type. On failure the
 * tool is NOT executed and no value is ever invented — the caller turns
 * the message into an error tool result so the model sees exactly what
 * is missing. This is what stops a malformed `close_issue` call (no
 * `issueNumber`) from reaching the close path at all.
 *
 * Returns null when the arguments are acceptable; tools still perform
 * their own semantic validation (value ranges, preconditions) inside
 * `execute`.
 */
export function validateToolArgs(
    tool: AgentTool,
    args: Record<string, unknown>,
): string | null {
    const schema = tool.parameters as {
        required?: readonly string[] | string[];
        properties?: Record<string, { type?: string | string[] }>;
    };
    const missing = (schema.required ?? []).filter(
        (field) => args[field] === undefined || args[field] === null,
    );
    if (missing.length > 0) {
        const described = missing
            .map((field) => {
                const declared = schema.properties?.[field]?.type;
                const types = Array.isArray(declared)
                    ? declared.join(" or ")
                    : declared;
                return types ? `${field} (${types})` : field;
            })
            .join(", ");
        return (
            `Invalid arguments for ${tool.name}: missing required field(s): ` +
            `${described}. The tool was not executed and no value ` +
            `was assumed — use the exact parameter names declared in the ` +
            `tool schema and call ${tool.name} again.`
        );
    }
    for (const [field, value] of Object.entries(args)) {
        if (value === undefined || value === null) continue;
        const declared = schema.properties?.[field]?.type;
        if (!declared) continue;
        const types = Array.isArray(declared) ? declared : [declared];
        const actual = Array.isArray(value) ? "array" : typeof value;
        const matches = types.some(
            (type) =>
                type === actual ||
                (type === "integer" && actual === "number" && Number.isInteger(value)),
        );
        if (!matches) {
            return (
                `Invalid arguments for ${tool.name}: field '${field}' must be ` +
                `${types.join(" or ")}, received ${actual}. The tool was not executed.`
            );
        }
    }
    return null;
}

/**
 * Execute a tool under its timeout budget. The abandoned promise keeps
 * running in the background (tools are not cancellable), but its eventual
 * settlement is absorbed by Promise.race so it can never become an
 * unhandled rejection or affect the run.
 */
async function executeToolWithTimeout(
    tool: AgentTool,
    args: Record<string, any>,
    sandboxId: string,
): Promise<ToolExecutionOutcome> {
    const timeoutMs =
        typeof tool.timeoutMs === "number" && tool.timeoutMs > 0
            ? tool.timeoutMs
            : DEFAULT_TOOL_TIMEOUT_MS;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const execution = tool.execute(args, sandboxId);
        const result = await Promise.race([
            execution,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new ToolTimeoutError(tool.name, timeoutMs)),
                    timeoutMs,
                );
            }),
        ]);
        return { result, elapsedMs: Date.now() - startedAt, timedOut: false, failed: false };
    } catch (error) {
        const elapsedMs = Date.now() - startedAt;
        if (error instanceof ToolTimeoutError) {
            return {
                result: `Tool timed out after ${timeoutMs}ms: ${tool.name} did not finish in time.`,
                elapsedMs,
                timedOut: true,
                failed: false,
            };
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
            result: `Tool execution failed: ${message}`,
            elapsedMs,
            timedOut: false,
            failed: true,
        };
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

export interface LoopInput {
    messages: LoopMessage[];
    tools: AgentTool[];
    onEvent: AgentEventCallback;
    modelFn: ModelFn;
    /** Correlation id for timing logs. */
    sessionId?: string;
    initialSandboxId?: string;
    createSandbox?: () => Promise<string>;
    prepareSandbox?: () => Promise<void>;
    /**
     * Called when the model returns no tool calls (a candidate final answer).
     * Return a corrective message to append and keep the loop going, or null
     * to accept the message as the run's final answer. The callback owns the
     * retry budget so a blocked run can still terminate.
     */
    nudgeOnStop?: (content: string) => string | null;
}

function convertToolsToOpenRouter(
    tools: AgentTool[],
): Array<{
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}> {
    return tools.map((tool) => ({
        type: "function" as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters as Record<string, unknown>,
        },
    }));
}

export async function runLoop(input: LoopInput): Promise<void> {
    const { messages, tools, onEvent, modelFn } = input;

    const openRouterTools = convertToolsToOpenRouter(tools);
    const conversation: LoopMessage[] = [...messages];
    const toolNames = new Set(tools.map((tool) => tool.name));
    // Names and count only — never arguments or secrets — so runs can be
    // verified against the model request in local diagnostics.
    console.log(
        `[AgentLoop] tools(${tools.length}): ${[...toolNames].join(", ")}`,
    );
    // For tools with one obvious argument, a bare string written in prose
    // (`run_command("npm test")`) can be mapped onto that parameter.
    const paramHints: Record<string, string> = {};
    for (const tool of tools) {
        const required = tool.parameters.required ?? [];
        const properties = Object.keys(tool.parameters.properties ?? {});
        if (required.length === 1 && properties.includes(required[0]!)) {
            paramHints[tool.name] = required[0]!;
        } else if (required.length === 0 && properties.length === 1) {
            paramHints[tool.name] = properties[0]!;
        }
    }
    let sandboxId: string | undefined = input.initialSandboxId;
    let sandboxPrepared = false;
    let capabilityCorrections = 0;
    let toolRetryNudges = 0;
    // Failure of the most recent tool-call batch (null after a batch in
    // which every call succeeded). Drives the bounded retry nudge AND the
    // GitHub-mutation gate below: while a failure is unresolved, the run is
    // in recovery and an external mutation is never the way out.
    let lastToolFailure: { toolName: string; message: string } | null = null;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        let response = await modelFn(conversation, openRouterTools);

        // Local models sometimes emit a tool call as message text (JSON or a
        // shell-style `run_command("...")`) instead of a structured
        // `tool_calls` entry. Recover it so the call is actually executed (and
        // its preconditions enforced) rather than being rendered as the final
        // answer.
        let recoveredCallIds: string[] = [];
        if (
            (!response.toolCalls || response.toolCalls.length === 0) &&
            response.content
        ) {
            const recovered = recoverTextToolCalls(
                response.content,
                toolNames,
                paramHints,
            );
            if (recovered) {
                recoveredCallIds = recovered.toolCalls.map((call) => call.id);
                response = {
                    ...response,
                    toolCalls: recovered.toolCalls,
                    content: recovered.remainder,
                };
            }
        }

        // Attribution: names and ids only (never arguments) so an incident
        // can be reconstructed from logs — which calls the MODEL returned
        // for this iteration (and which of those were recovered from prose)
        // versus what the runtime then executed.
        const modelCallSummary = (response.toolCalls ?? [])
            .map((call) => `${call.id}:${call.function.name}`)
            .join(", ");
        console.log(
            `[AgentLoop] iteration=${iteration} finish=${response.finishReason ?? "none"} ` +
                `model_calls=[${modelCallSummary}]` +
                (recoveredCallIds.length > 0
                    ? ` recovered=[${recoveredCallIds.join(", ")}]`
                    : ""),
        );

        const hasToolCalls =
            response.toolCalls !== null &&
            response.toolCalls !== undefined &&
            response.toolCalls.length > 0;

        if (!hasToolCalls) {
            const finalContent = response.content ?? "";

            // A small model sometimes hallucinates that no tool can read
            // repository files even though the tools are registered and were
            // sent in this very request. Correct that claim against the
            // actual registered set — bounded, and never applied to ordinary
            // answers or truthful missing-context responses.
            if (
                capabilityCorrections < MAX_CAPABILITY_CORRECTIONS &&
                isFalseCapabilityRefusal(finalContent, toolNames.size > 0)
            ) {
                capabilityCorrections += 1;
                if (finalContent) {
                    conversation.push({ role: "assistant", content: finalContent });
                }
                // Quote the user's actual request so the correction cannot be
                // mistaken for a new instruction — the model must act on the
                // ORIGINAL request, not on this meta-message about tools.
                // Skip earlier corrective messages (a second correction must
                // still quote the real request).
                const originalRequest = [...conversation]
                    .reverse()
                    .find(
                        (message) =>
                            message.role === "user" &&
                            !String(message.content ?? "").startsWith(
                                "That claim about tool availability is incorrect",
                            ) &&
                            !String(message.content ?? "").startsWith(
                                "The previous tool call failed",
                            ),
                    )
                    ?.content?.slice(0, 400);
                conversation.push({
                    role: "user",
                    content:
                        `That claim about tool availability is incorrect: verify it against the "Registered tools" list in your instructions. ` +
                        `Tools registered for this run: ${[...toolNames].join(", ")}. ` +
                        "The registered inventory is authoritative — never answer a capability question from conversation history. " +
                        (originalRequest
                            ? `The user's current request is: "${originalRequest}". If that request requires one of these tools, emit that tool call now instead of replying with prose about tools, `
                            : "If the user's current request requires one of these tools, emit that tool call now instead of replying with prose about tools, ") +
                        "and take no action the user did not ask for. " +
                        "If a tool fails, read its actual error and report it accurately.",
                });
                onEvent({
                    type: "AGENT_STATUS",
                    content:
                        "Correcting incorrect tool-availability information — continuing the run",
                });
                continue;
            }

            // A tool call failed and the model answered with prose instead
            // of retrying (e.g. it handed the task back to the user). Push
            // it to act on the actual error, anchored to the tool that
            // failed — bounded, and it never fabricates arguments; the model
            // must derive the fix from the error message itself.
            if (
                lastToolFailure !== null &&
                toolRetryNudges < MAX_TOOL_RETRY_NUDGES
            ) {
                toolRetryNudges += 1;
                if (finalContent) {
                    conversation.push({
                        role: "assistant",
                        content: finalContent,
                    });
                }
                conversation.push({
                    role: "user",
                    content:
                        `The previous tool call failed: "${lastToolFailure.message.slice(0, 400)}". ` +
                        `Do not hand this back to the user. Read the error, correct the arguments ` +
                        `of ${lastToolFailure.toolName} (the message may name the exact fix), and call ` +
                        `${lastToolFailure.toolName} again. A failure is recovered by fixing that same ` +
                        `objective — a wrong path is recovered with the corrected path or list_files — ` +
                        `never by switching to an unrelated tool such as an issue, PR, or git command. ` +
                        "If the error shows an external account or service is not connected and " +
                        "changing arguments cannot help, reply with that explanation and stop.",
                });
                onEvent({
                    type: "AGENT_STATUS",
                    content:
                        "Tool call failed — asking the model to correct its arguments and retry",
                });
                continue;
            }

            // A model can stop while the requested work is still unfinished
            // (prose instead of the next tool call). Let the caller decide
            // whether to push the run forward one more time.
            const nudge = input.nudgeOnStop?.(finalContent);
            if (nudge) {
                if (response.content) {
                    conversation.push({
                        role: "assistant",
                        content: response.content,
                    });
                }
                conversation.push({ role: "user", content: nudge });
                onEvent({
                    type: "AGENT_STATUS",
                    content: "Requested steps are still incomplete — continuing the run",
                });
                continue;
            }
            if (response.content) {
                onEvent({
                    type: "AGENT_MESSAGE",
                    content: response.content,
                });
            }
            return;
        }

        conversation.push({
            role: "assistant",
            content: response.content,
            toolCalls: response.toolCalls!,
        });

        // Failure of the most recent call in this batch (null when the batch
        // had no failures); assigned to lastToolFailure after the loop (a
        // fully successful batch clears the previous failure).
        let batchFailure: { toolName: string; message: string } | null = null;

        for (const toolCall of response.toolCalls!) {
            onEvent({
                type: "TOOL_CALL",
                toolCall: {
                    id: toolCall.id,
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments,
                },
            });

            const tool = tools.find((t) => t.name === toolCall.function.name);

            if (!tool) {
                const errorMessage = `Unknown tool: ${toolCall.function.name}. Available tools: ${tools
                    .map((tool) => tool.name)
                    .join(", ")}`;
                batchFailure = {
                    toolName: toolCall.function.name,
                    message: errorMessage,
                };
                onEvent({
                    type: "TOOL_RESULT",
                    toolResult: {
                        toolCallId: toolCall.id,
                        output: errorMessage,
                        isError: true,
                    },
                });
                conversation.push({
                    role: "tool",
                    toolCallId: toolCall.id,
                    content: errorMessage,
                });
                continue;
            }

            let args: Record<string, any>;
            try {
                const parsed = JSON.parse(toolCall.function.arguments);
                if (
                    parsed === null ||
                    typeof parsed !== "object" ||
                    Array.isArray(parsed)
                ) {
                    throw new Error("arguments must be a JSON object");
                }
                args = parsed;
            } catch {
                const errorMessage = `Invalid JSON arguments for tool ${toolCall.function.name}: ${toolCall.function.arguments}`;
                batchFailure = {
                    toolName: toolCall.function.name,
                    message: errorMessage,
                };
                onEvent({
                    type: "TOOL_RESULT",
                    toolResult: {
                        toolCallId: toolCall.id,
                        output: errorMessage,
                        isError: true,
                    },
                });
                conversation.push({
                    role: "tool",
                    toolCallId: toolCall.id,
                    content: errorMessage,
                });
                continue;
            }

            // Schema gate: a call missing required fields (e.g. close_issue
            // without issueNumber) is rejected here, before dispatch to the
            // tool — the wrong operation can never run and no argument is
            // silently invented. Validation runs before sandbox creation so
            // an invalid call has no side effects at all.
            const validationError = validateToolArgs(tool, args);
            if (validationError !== null) {
                batchFailure = {
                    toolName: tool.name,
                    message: validationError,
                };
                onEvent({
                    type: "TOOL_RESULT",
                    toolResult: {
                        toolCallId: toolCall.id,
                        output: validationError,
                        isError: true,
                    },
                });
                conversation.push({
                    role: "tool",
                    toolCallId: toolCall.id,
                    content: validationError,
                });
                continue;
            }

            // Recovery gate: while the run is recovering from a failed call
            // (this batch or the previous one), a GitHub mutation is never
            // the way out — a failure is resolved with a corrected or
            // same-objective action (corrected path, list_files, retry),
            // never with an unrelated external side effect. The blocked call
            // returns its error to the model like any other rejection, and
            // may be re-issued once a batch succeeds again. State-based, not
            // keyword-based: intent selection stays with the model.
            if (
                tool.githubMutation === true &&
                (lastToolFailure !== null || batchFailure !== null)
            ) {
                const priorFailure =
                    lastToolFailure !== null
                        ? ` ("${lastToolFailure.toolName}": ${lastToolFailure.message.slice(0, 200)})`
                        : "";
                const blockMessage: string =
                    `Blocked: ${tool.name} is a GitHub mutation and this run is still ` +
                    `recovering from a failed tool call` +
                    priorFailure +
                    `. Resolve that failure first with the same objective (correct the failed ` +
                    `call's arguments, or use list_files / a corrected read to find the right ` +
                    `path) — never with an issue, PR, or other mutation. If the user's request ` +
                    `requires ${tool.name}, call it again after the failure is resolved.`;
                batchFailure = {
                    toolName: tool.name,
                    message: blockMessage,
                };
                onEvent({
                    type: "TOOL_RESULT",
                    toolResult: {
                        toolCallId: toolCall.id,
                        output: blockMessage,
                        isError: true,
                    },
                });
                conversation.push({
                    role: "tool",
                    toolCallId: toolCall.id,
                    content: blockMessage,
                });
                continue;
            }

            if (tool.requiresSandbox) {
                if (!sandboxId && input.createSandbox) {
                    onEvent({ type: "AGENT_STATUS", content: "Creating sandbox..." });
                    sandboxId = await input.createSandbox();
                    sandboxPrepared = true;
                    onEvent({ type: "AGENT_STATUS", content: `Sandbox ready: ${sandboxId}` });
                } else if (sandboxId && input.prepareSandbox && !sandboxPrepared) {
                    await input.prepareSandbox();
                    sandboxPrepared = true;
                }
            }

            const { result, elapsedMs, timedOut, failed } =
                await executeToolWithTimeout(tool, args, sandboxId ?? "");

            console.log(
                `[Timing] sessionId=${input.sessionId ?? "none"} phase=tool_execution callId=${toolCall.id} tool=${tool.name} elapsed=${elapsedMs}ms ok=${!timedOut && !failed}${timedOut ? " reason=timeout" : ""}`,
            );

            const resultString =
                typeof result === "string" ? result : JSON.stringify(result);

            // Tools report failures as "Error …" strings (isError only
            // covers timeouts/crashes), so the nudge keys off both.
            if (timedOut || failed || /^\s*error\b/i.test(resultString)) {
                batchFailure = { toolName: tool.name, message: resultString };
            }

            onEvent({
                type: "TOOL_RESULT",
                toolResult: {
                    toolCallId: toolCall.id,
                    output: resultString,
                    isError: timedOut || failed,
                },
            });

            conversation.push({
                role: "tool",
                toolCallId: toolCall.id,
                content: resultString,
            });
        }

        lastToolFailure = batchFailure;
    }

    onEvent({
        type: "AGENT_ERROR",
        content: `Max iterations (${MAX_ITERATIONS}) reached`,
    });
}
