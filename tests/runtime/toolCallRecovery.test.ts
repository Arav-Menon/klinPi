import { describe, it, expect } from "vitest";
import { recoverTextToolCalls } from "../../packages/runtime/src/lib/toolCallRecovery.js";

const TOOLS = new Set(["create_pull_request", "create_issue", "list_files"]);

describe("recoverTextToolCalls", () => {
    it("recovers a bare {name, arguments} tool call", () => {
        const content = JSON.stringify({
            name: "create_pull_request",
            arguments: {
                owner: "Arav-Menon",
                repo: "trial",
                title: "Improve Dockerfile",
                head: "feat/frontend-docker-prod",
                base: "main",
            },
        });

        const recovered = recoverTextToolCalls(content, TOOLS);

        expect(recovered).not.toBeNull();
        expect(recovered!.remainder).toBeNull();
        expect(recovered!.toolCalls).toHaveLength(1);
        expect(recovered!.toolCalls[0]!.type).toBe("function");
        expect(recovered!.toolCalls[0]!.function.name).toBe("create_pull_request");
        expect(JSON.parse(recovered!.toolCalls[0]!.function.arguments)).toEqual({
            owner: "Arav-Menon",
            repo: "trial",
            title: "Improve Dockerfile",
            head: "feat/frontend-docker-prod",
            base: "main",
        });
    });

    it("recovers the {function: '<tool>'} shape emitted by local models", () => {
        const content = `{
  "function": "create_issue",
  "arguments": { "title": "Make Dockerfile production-ready" }
}`;

        const recovered = recoverTextToolCalls(content, TOOLS);

        expect(recovered!.toolCalls[0]!.function.name).toBe("create_issue");
        expect(JSON.parse(recovered!.toolCalls[0]!.function.arguments)).toEqual({
            title: "Make Dockerfile production-ready",
        });
        expect(recovered!.remainder).toBeNull();
    });

    it("recovers a nested {function: {name, arguments}} call", () => {
        const content = JSON.stringify({
            function: { name: "list_files", arguments: { path: "/workspace" } },
        });

        const recovered = recoverTextToolCalls(content, TOOLS);

        expect(recovered!.toolCalls[0]!.function.name).toBe("list_files");
        expect(JSON.parse(recovered!.toolCalls[0]!.function.arguments)).toEqual({
            path: "/workspace",
        });
    });

    it("recovers a fenced json tool call", () => {
        const content =
            'I will open the pull request now.\n```json\n{"name":"create_pull_request","arguments":{"title":"t","head":"feat/x","base":"main"}}\n```';

        const recovered = recoverTextToolCalls(content, TOOLS);

        expect(recovered).not.toBeNull();
        expect(recovered!.toolCalls[0]!.function.name).toBe("create_pull_request");
        expect(recovered!.remainder).toBe("I will open the pull request now.");
    });

    it("keeps surrounding prose as the remainder", () => {
        const content =
            'Let me start by inspecting the repository.\n{"name":"list_files","arguments":{"path":"/workspace"}}';

        const recovered = recoverTextToolCalls(content, TOOLS);

        expect(recovered!.toolCalls[0]!.function.name).toBe("list_files");
        expect(recovered!.remainder).toBe(
            "Let me start by inspecting the repository.",
        );
    });

    it("accepts arguments given as a JSON string", () => {
        const content = '{"name":"list_files","arguments":"{\\"path\\":\\"/workspace\\"}"}';

        const recovered = recoverTextToolCalls(content, TOOLS);

        expect(JSON.parse(recovered!.toolCalls[0]!.function.arguments)).toEqual({
            path: "/workspace",
        });
    });

    it("recovers every call of a top-level array", () => {
        const content = JSON.stringify([
            { name: "list_files", arguments: { path: "/workspace" } },
            { name: "create_issue", arguments: { title: "t" } },
        ]);

        const recovered = recoverTextToolCalls(content, TOOLS);

        expect(recovered!.toolCalls.map((c) => c.function.name)).toEqual([
            "list_files",
            "create_issue",
        ]);
    });

    it("recovers an unregistered tool name when it carries arguments so the loop can correct it", () => {
        const content =
            '{"name":"update_file","arguments":{"path":"/workspace/Dockerfile","content":"FROM node"}}';

        const recovered = recoverTextToolCalls(content, TOOLS);

        expect(recovered).not.toBeNull();
        expect(recovered!.toolCalls[0]!.function.name).toBe("update_file");
        expect(JSON.parse(recovered!.toolCalls[0]!.function.arguments)).toEqual({
            path: "/workspace/Dockerfile",
            content: "FROM node",
        });
        expect(recovered!.remainder).toBeNull();
    });

    it("ignores an unregistered name that has no argument payload", () => {
        const content = '{"name":"delete_everything"}';

        expect(recoverTextToolCalls(content, TOOLS)).toBeNull();
    });

    it("ignores ordinary data JSON that has a name but no arguments", () => {
        const content = '{"name":"some record","id":42}';

        expect(recoverTextToolCalls(content, TOOLS)).toBeNull();
    });

    it("ignores prose that only mentions tool names", () => {
        const content =
            "I would call create_pull_request, but the branch is not pushed yet.";

        expect(recoverTextToolCalls(content, TOOLS)).toBeNull();
    });

    it("ignores malformed argument strings", () => {
        const content = '{"name":"list_files","arguments":"not-json"}';

        expect(recoverTextToolCalls(content, TOOLS)).toBeNull();
    });

    it("ignores an empty tool set", () => {
        const content = '{"name":"list_files","arguments":{}}';

        expect(recoverTextToolCalls(content, new Set())).toBeNull();
    });

    it("generates a distinct id for each recovered call", () => {
        const content = JSON.stringify([
            { name: "list_files", arguments: {} },
            { name: "create_issue", arguments: {} },
        ]);

        const recovered = recoverTextToolCalls(content, TOOLS);

        const ids = recovered!.toolCalls.map((call) => call.id);
        expect(new Set(ids).size).toBe(2);
        expect(ids.every((id) => id.length > 0)).toBe(true);
    });
});

describe("recoverTextToolCalls pseudo-calls", () => {
    const HINTS = { run_command: "command" };

    it("recovers a shell-style call from a fenced bash block", () => {
        const content = "Next step:\n```bash\nrun_command(\"npm test\")\n```";

        const recovered = recoverTextToolCalls(content, TOOLS, HINTS);

        expect(recovered).not.toBeNull();
        expect(recovered!.toolCalls[0]!.function.name).toBe("run_command");
        expect(JSON.parse(recovered!.toolCalls[0]!.function.arguments)).toEqual({
            command: "npm test",
        });
        expect(recovered!.remainder).toBe("Next step:");
    });

    it("recovers a call whose arguments are a JSON object", () => {
        const content = "```text\nlist_files({\"path\":\"/workspace\"})\n```";

        const recovered = recoverTextToolCalls(content, TOOLS, HINTS);

        expect(recovered!.toolCalls[0]!.function.name).toBe("list_files");
        expect(JSON.parse(recovered!.toolCalls[0]!.function.arguments)).toEqual({
            path: "/workspace",
        });
    });

    it("tolerates unquoted keys in pseudo-call arguments", () => {
        const content = "```bash\nedit_file({path: \"/workspace/Dockerfile\", content: \"FROM node\"})\n```";

        const recovered = recoverTextToolCalls(content, TOOLS, HINTS);

        expect(recovered!.toolCalls[0]!.function.name).toBe("edit_file");
        expect(JSON.parse(recovered!.toolCalls[0]!.function.arguments)).toEqual({
            path: "/workspace/Dockerfile",
            content: "FROM node",
        });
    });

    it("recovers the <function=name> form emitted by local models", () => {
        const content =
            "Working on it.\n<function=create_issue>{\"title\":\"Login bug\"}</function>";

        const recovered = recoverTextToolCalls(content, TOOLS, HINTS);

        expect(recovered!.toolCalls[0]!.function.name).toBe("create_issue");
        expect(JSON.parse(recovered!.toolCalls[0]!.function.arguments)).toEqual({
            title: "Login bug",
        });
    });

    it("recovers the name: \"arguments\" form", () => {
        const content = "run_command: \"npm test\"";

        const recovered = recoverTextToolCalls(content, TOOLS, HINTS);

        expect(recovered!.toolCalls[0]!.function.name).toBe("run_command");
        expect(JSON.parse(recovered!.toolCalls[0]!.function.arguments)).toEqual({
            command: "npm test",
        });
    });

    it("recovers an unregistered pseudo-call so the loop can correct it", () => {
        const content = "```bash\nupdate_file({path: \"/workspace/x\", content: \"y\"})\n```";

        const recovered = recoverTextToolCalls(content, TOOLS, HINTS);

        expect(recovered!.toolCalls[0]!.function.name).toBe("update_file");
    });

    it("ignores a bare string argument when the tool has no single obvious parameter", () => {
        const content = "```bash\ngit_push(\"feat/x\")\n```";

        expect(recoverTextToolCalls(content, TOOLS, HINTS)).toBeNull();
    });

    it("ignores a call followed by trailing explanation", () => {
        const content =
            "```bash\nrun_command(\"npm test\") and then some more prose about it\n```";

        expect(recoverTextToolCalls(content, TOOLS, HINTS)).toBeNull();
    });

    it("ignores prose that mentions a call inline without a fence", () => {
        const content = 'You could use run_command("npm test") to check this.';

        expect(recoverTextToolCalls(content, TOOLS, HINTS)).toBeNull();
    });
});

describe("recoverTextToolCalls action/params shapes", () => {
    it("recovers {action, params} as written by local models", () => {
        const content = '{"action": "git_branch", "params": {"branch": "feat/dockerfile"}}';

        const recovered = recoverTextToolCalls(content, TOOLS);

        expect(recovered).not.toBeNull();
        expect(recovered!.toolCalls[0]!.function.name).toBe("git_branch");
        expect(JSON.parse(recovered!.toolCalls[0]!.function.arguments)).toEqual({
            branch: "feat/dockerfile",
        });
    });

    it("recovers {name, parameters}", () => {
        const content = '{"name": "git_status", "parameters": {}}';

        const recovered = recoverTextToolCalls(content, TOOLS);

        expect(recovered!.toolCalls[0]!.function.name).toBe("git_status");
        expect(JSON.parse(recovered!.toolCalls[0]!.function.arguments)).toEqual({});
    });

    it("recovers an unregistered action with params so the loop corrects it", () => {
        const content = '{"action": "update_file", "params": {"path": "/workspace/x"}}';

        const recovered = recoverTextToolCalls(content, TOOLS);

        expect(recovered!.toolCalls[0]!.function.name).toBe("update_file");
    });

    it("still ignores unrelated data JSON", () => {
        const content = '{"kind": "report", "payload": {"path": "/tmp"}}';

        expect(recoverTextToolCalls(content, TOOLS)).toBeNull();
    });
});

describe("recoverTextToolCalls function_call wrapper shapes", () => {
    it("recovers <function_call>{function_name, arguments}</function_call>", () => {
        const content = `<function_call>
{
  "function_name": "create_issue",
  "arguments": { "title": "Fix login button", "body": "Steps to reproduce..." }
}
</function_call>`;

        const recovered = recoverTextToolCalls(content, TOOLS);

        expect(recovered).not.toBeNull();
        expect(recovered!.remainder).toBeNull();
        expect(recovered!.toolCalls).toHaveLength(1);
        expect(recovered!.toolCalls[0]!.function.name).toBe("create_issue");
        expect(JSON.parse(recovered!.toolCalls[0]!.function.arguments)).toEqual({
            title: "Fix login button",
            body: "Steps to reproduce...",
        });
    });

    it("keeps prose before the wrapper as the remainder", () => {
        const content = `I will open that issue now.

<function_call>{"function_name":"create_issue","arguments":{"title":"UI Redesign"}}</function_call>`;

        const recovered = recoverTextToolCalls(content, TOOLS);

        expect(recovered).not.toBeNull();
        expect(recovered!.remainder).toBe("I will open that issue now.");
        expect(recovered!.toolCalls[0]!.function.name).toBe("create_issue");
    });

    it("recovers a function_name payload from a fenced json block", () => {
        const content = `Opening the issue now:

\`\`\`json
<function_call>
{"function_name": "create_issue", "arguments": {"title": "UI Redesign"}}
</function_call>
\`\`\``;

        const recovered = recoverTextToolCalls(content, TOOLS);

        expect(recovered).not.toBeNull();
        expect(recovered!.remainder).toBe("Opening the issue now:");
        expect(recovered!.toolCalls[0]!.function.name).toBe("create_issue");
        expect(JSON.parse(recovered!.toolCalls[0]!.function.arguments)).toEqual({
            title: "UI Redesign",
        });
    });

    it("recovers a bare {function_name, arguments} object", () => {
        const content = `{
  "function_name": "create_issue",
  "arguments": { "title": "UI Redesign" }
}`;

        const recovered = recoverTextToolCalls(content, TOOLS);

        expect(recovered).not.toBeNull();
        expect(recovered!.remainder).toBeNull();
        expect(recovered!.toolCalls[0]!.function.name).toBe("create_issue");
        expect(JSON.parse(recovered!.toolCalls[0]!.function.arguments)).toEqual({
            title: "UI Redesign",
        });
    });

    it("recovers an unregistered function_name so the loop can correct it", () => {
        const content = `<function_call>{"function_name":"close_issue","arguments":{"issueNumber":7}}</function_call>`;

        const recovered = recoverTextToolCalls(content, TOOLS);

        expect(recovered).not.toBeNull();
        expect(recovered!.toolCalls[0]!.function.name).toBe("close_issue");
    });
});
