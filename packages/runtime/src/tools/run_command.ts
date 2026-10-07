import type { AgentTool } from "../types.js";
import {
    OUTPUT_LIMIT,
    WORKSPACE_PATH,
    runShell,
    scrubSecretPatterns,
    truncateOutput,
} from "./git_tools/git_helpers.js";

function isWorkspacePath(path: string): boolean {
    return path === WORKSPACE_PATH || path.startsWith(`${WORKSPACE_PATH}/`);
}

function resolveTarget(raw: string, cwd: string): string {
    if (raw.startsWith("/")) {
        return raw;
    }
    return cwd === "/" ? `/${raw}` : `${cwd}/${raw}`;
}

/** Split a command into tokens, honouring quotes and shell operators. */
function tokenize(command: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let has = false;
    let inSingle = false;
    let inDouble = false;

    const push = () => {
        if (has) {
            tokens.push(current);
            current = "";
            has = false;
        }
    };

    for (const char of command) {
        if (char === "'" && !inDouble) {
            inSingle = !inSingle;
            has = true;
            continue;
        }
        if (char === '"' && !inSingle) {
            inDouble = !inDouble;
            has = true;
            continue;
        }
        if (!inSingle && !inDouble && /[\s|;&<>]/.test(char)) {
            push();
            continue;
        }
        current += char;
        has = true;
    }
    push();
    return tokens;
}

/**
 * Targets of `>` / `>>` redirections that appear outside quotes, so a message
 * like `git commit -m "a > b"` is not mistaken for a write. File descriptor
 * duplication (`>&1`, `2>&1`) is ignored.
 */
function findRedirectTargets(command: string): string[] {
    const targets: string[] = [];
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < command.length; i++) {
        const char = command[i]!;
        if (char === "'" && !inDouble) {
            inSingle = !inSingle;
            continue;
        }
        if (char === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if (inSingle || inDouble || char !== ">") {
            continue;
        }

        let j = i + 1;
        if (command[j] === ">") {
            j++;
        }
        while (j < command.length && /\s/.test(command[j]!)) {
            j++;
        }
        if (command[j] === "&" || j >= command.length) {
            continue;
        }

        let target = "";
        const quote = command[j];
        if (quote === "'" || quote === '"') {
            const end = command.indexOf(quote, j + 1);
            if (end === -1) {
                continue;
            }
            target = command.slice(j + 1, end);
            j = end + 1;
        } else {
            const start = j;
            while (j < command.length && !/[\s;|&]/.test(command[j]!)) {
                j++;
            }
            target = command.slice(start, j);
        }

        if (target && !/^\d*$/.test(target)) {
            targets.push(target);
        }
        i = Math.max(i, j - 1);
    }
    return targets;
}

/**
 * Files under /workspace that the command would create or modify directly
 * (redirection, `tee`, in-place `sed`). These bypass read_file → edit_file,
 * so they are refused before the command runs.
 */
function findWorkspaceWrites(command: string, cwd: string): string[] {
    const paths = new Set<string>();

    for (const target of findRedirectTargets(command)) {
        paths.add(resolveTarget(target, cwd));
    }

    const tokens = tokenize(command);

    const teeIndex = tokens.findIndex((token) => token === "tee");
    if (teeIndex !== -1) {
        let k = teeIndex + 1;
        while (k < tokens.length && tokens[k]!.startsWith("-")) {
            k++;
        }
        for (; k < tokens.length; k++) {
            paths.add(resolveTarget(tokens[k]!, cwd));
        }
    }

    const sedIndex = tokens.findIndex((token) => token === "sed");
    if (sedIndex !== -1) {
        let k = sedIndex + 1;
        let inPlace = false;
        while (k < tokens.length && tokens[k]!.startsWith("-")) {
            if (tokens[k]!.includes("i")) {
                inPlace = true;
            }
            k++;
        }
        if (inPlace) {
            k++; // skip the sed script argument
            for (; k < tokens.length; k++) {
                paths.add(resolveTarget(tokens[k]!, cwd));
            }
        }
    }

    return [...paths].filter(isWorkspacePath);
}


export const run_command: AgentTool = {
    name: "run_command",
    requiresSandbox: true,
    description:
        "Run a shell command inside the sandbox (default working directory /workspace). Use this for validation — tests, type checking, linting, formatting, builds. For reading file contents prefer read_file and for listing directories prefer list_files instead of cat/ls. For Git operations prefer the dedicated git_branch, git_status, git_diff, git_stage, git_commit and git_push tools. Creating or modifying repository files must go through read_file → edit_file: redirections into /workspace ('> file', '>> file', tee, sed -i) are refused by this tool. Output is truncated to a safe length.",

    parameters: {
        type: "object",
        properties: {
            command: {
                type: "string",
                description:
                    "The shell command to execute, e.g. 'npm test' or 'npx tsc --noEmit'",
            },
            cwd: {
                type: "string",
                description: `Working directory (default: ${WORKSPACE_PATH}); relative paths are resolved against ${WORKSPACE_PATH}`,
            },
        },
        required: ["command"],
    },

    async execute(args, sandboxId) {
        const { command, cwd } = args as { command?: unknown; cwd?: unknown };

        if (typeof command !== "string" || !command.trim()) {
            return "Error: 'command' must be a non-empty string.";
        }
        if (cwd !== undefined && typeof cwd !== "string") {
            return "Error: 'cwd' must be a string.";
        }

        if (!sandboxId) {
            return "Error: No sandbox available. The agent has not initialized a sandbox yet.";
        }

        const workingDirectory =
            typeof cwd === "string" && cwd.trim()
                ? cwd.trim().startsWith("/")
                    ? cwd.trim()
                    : `${WORKSPACE_PATH}/${cwd.trim().replace(/^\.\//, "")}`
                : WORKSPACE_PATH;

        const workspaceWrites = findWorkspaceWrites(command, workingDirectory);
        if (workspaceWrites.length > 0) {
            const shown = workspaceWrites.slice(0, 3).join(", ");
            const more =
                workspaceWrites.length > 3
                    ? ` and ${workspaceWrites.length - 3} more`
                    : "";
            return (
                `Error: run_command must not create or modify repository files (write target(s): ${shown}${more}). ` +
                "Inspect the repository with list_files, read the file with read_file, then change it with edit_file so the change is tracked and validated."
            );
        }

        try {
            const result = await runShell(sandboxId, command, workingDirectory);
            const stdout = scrubSecretPatterns(result.stdout);
            const stderr = scrubSecretPatterns(result.stderr);

            const sections = [`Exit code: ${result.exitCode}`];
            if (stdout.trim()) {
                sections.push(`stdout:\n${truncateOutput(stdout.trim(), OUTPUT_LIMIT)}`);
            }
            if (stderr.trim()) {
                sections.push(`stderr:\n${truncateOutput(stderr.trim(), OUTPUT_LIMIT)}`);
            }
            if (!stdout.trim() && !stderr.trim()) {
                sections.push("(no output)");
            }
            return sections.join("\n");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `Error running command: ${scrubSecretPatterns(message)}`;
        }
    },
};
