import { sandboxManger } from "@klinpi/compute";

export const WORKSPACE_PATH = "/workspace";
export const OUTPUT_LIMIT = 10000;

export interface ShellResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function scrubSecretPatterns(text: string): string {
    let out = text.replace(/x-access-token:[^@\s]*@/g, "x-access-token:***@");
    out = out.replace(/oauth2:[^@\s]*@/g, "oauth2:***@");
    out = out.replace(/Bearer\s+\S+/gi, "Bearer ***");
    return out;
}

export function truncateOutput(text: string, limit: number = OUTPUT_LIMIT): string {
    if (text.length <= limit) {
        return text;
    }
    return `${text.slice(0, limit)}\n... (output truncated after ${limit} characters)`;
}

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function isValidBranchName(branch: string): boolean {
    return (
        branch.length > 0 &&
        branch.length <= 200 &&
        BRANCH_NAME_PATTERN.test(branch) &&
        !branch.includes("..") &&
        !branch.includes("//") &&
        !branch.endsWith("/") &&
        !branch.endsWith(".") &&
        !branch.endsWith(".lock")
    );
}

export function describeInvalidBranchName(branch: string): string | null {
    if (!branch.trim()) {
        return "branch name must be a non-empty string";
    }
    if (!isValidBranchName(branch)) {
        return `'${branch}' is not a valid branch name (letters, digits, '.', '_' and '/' only, e.g. 'feat/add-get-documentation')`;
    }
    return null;
}

export function normalizeRepoPath(path: string): string {
    const trimmed = path.trim();
    if (trimmed === WORKSPACE_PATH) {
        return ".";
    }
    if (trimmed.startsWith(`${WORKSPACE_PATH}/`)) {
        return trimmed.slice(WORKSPACE_PATH.length + 1);
    }
    return trimmed;
}

export async function runShell(
    sandboxId: string,
    command: string,
    cwd: string = WORKSPACE_PATH,
): Promise<ShellResult> {
    if (!sandboxId) {
        throw new Error("No sandbox available. The agent has not initialized a sandbox yet.");
    }
    const sandbox = await sandboxManger.connectSbx(sandboxId);
    try {
        const result = await sandbox.commands.run(command, { cwd });
        return {
            exitCode: result.exitCode,
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
        };
    } catch (error) {
        const exitCode = (error as { exitCode?: unknown }).exitCode;
        if (typeof exitCode === "number") {
            return {
                exitCode,
                stdout: String((error as { stdout?: string }).stdout ?? ""),
                stderr: String((error as { stderr?: string }).stderr ?? ""),
            };
        }
        throw error;
    }
}

export async function ensureGitRepository(sandboxId: string): Promise<string | null> {
    try {
        const check = await runShell(
            sandboxId,
            `test -d ${WORKSPACE_PATH}/.git && echo HAS_REPO || echo NO_REPO`,
            "/",
        );
        if (check.stdout.includes("HAS_REPO")) {
            return null;
        }
        return `Error: ${WORKSPACE_PATH} does not contain a Git repository. Link a repository to the session (the runtime clones it automatically) or call clone_repo first.`;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error accessing the sandbox workspace: ${message}`;
    }
}
