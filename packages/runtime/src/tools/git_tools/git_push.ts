import type { AgentTool, ToolContext } from "../../types.js";
import { resolveGitHubToken, sanitize } from "../github_tools/github_auth.js";
import {
    describeInvalidBranchName,
    ensureGitRepository,
    runShell,
    scrubSecretPatterns,
    shellQuote,
    truncateOutput,
} from "./git_helpers.js";

const REMOTE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const DEFAULT_BRANCHES = new Set(["main", "master"]);

export function createGitPushTool(context: ToolContext): AgentTool {
    const { workflow } = context;

    return {
        name: "git_push",
        requiresSandbox: true,
        description:
            "Push a local branch of the sandbox repository (/workspace) to its Git remote and set the upstream. Defaults to the current checked-out branch; pass 'branch' to push a specific local branch. Only when the user requested a push or PR workflow — never for read-only requests. The push MUST succeed before create_pull_request can be called — GitHub needs the branch to exist on the remote as the PR head. Uses the authenticated user's connected GitHub account; the caller never provides credentials or a user id.",

        parameters: {
            type: "object",
            properties: {
                remote: {
                    type: "string",
                    description: "Remote name to push to (default: 'origin')",
                },
                branch: {
                    type: "string",
                    description:
                        "Local branch to push (e.g. 'feature/user-auth'). Defaults to the current checked-out branch",
                },
            },
            required: [],
        },

        async execute(args, sandboxId) {
            const { remote = "origin", branch: requestedBranch } = args as {
                remote?: unknown;
                branch?: unknown;
            };

            if (typeof remote !== "string" || !REMOTE_NAME_PATTERN.test(remote)) {
                return "Error: 'remote' must be a valid remote name such as 'origin'.";
            }
            if (requestedBranch !== undefined) {
                const invalidBranch = describeInvalidBranchName(
                    typeof requestedBranch === "string" ? requestedBranch : "",
                );
                if (invalidBranch) {
                    return `Error: invalid 'branch': ${invalidBranch}.`;
                }
            }

            if (!sandboxId) {
                return "Error: No sandbox available. The agent has not initialized a sandbox yet.";
            }

            try {
                const repoError = await ensureGitRepository(sandboxId);
                if (repoError) {
                    return repoError;
                }

                let branch: string;
                let refspec: string;
                if (typeof requestedBranch === "string") {
                    branch = requestedBranch;
                    const exists = await runShell(
                        sandboxId,
                        `git show-ref --verify --quiet ${shellQuote(`refs/heads/${branch}`)}`,
                    );
                    if (exists.exitCode !== 0) {
                        return `Error: local branch '${branch}' does not exist in this workspace. Create it with git_branch and commit on it before pushing.`;
                    }
                    refspec = shellQuote(`refs/heads/${branch}`);
                } else {
                    const branchResult = await runShell(
                        sandboxId,
                        "git rev-parse --abbrev-ref HEAD",
                    );
                    if (branchResult.exitCode !== 0) {
                        return `Error: cannot determine the current branch: ${branchResult.stderr.trim() || branchResult.stdout.trim()}`;
                    }
                    branch = branchResult.stdout.trim();
                    if (!branch || branch === "HEAD") {
                        return "Error: HEAD is detached. Check out a branch with git_branch before pushing.";
                    }
                    refspec = shellQuote(`HEAD:refs/heads/${branch}`);
                }

                const remoteUrlResult = await runShell(
                    sandboxId,
                    `git remote get-url ${shellQuote(remote)}`,
                );
                if (remoteUrlResult.exitCode !== 0) {
                    return `Error: no remote '${remote}' is configured in this workspace — the repository was not cloned from a remote, so it cannot be pushed.`;
                }
                const originalUrl = remoteUrlResult.stdout.trim();

                let token: string | undefined;
                if (context.userId) {
                    const lookup = await resolveGitHubToken(context.userId);
                    if (lookup.token) {
                        token = lookup.token;
                    } else if (
                        /^https:\/\/github\.com\//.test(originalUrl) &&
                        !/https:\/\/[^/@]+@github\.com\//.test(originalUrl)
                    ) {
                        return `Error: cannot push without GitHub credentials. ${lookup.error}`;
                    }
                }

                let pushUrl = originalUrl;
                if (token && /^https:\/\/github\.com\//.test(originalUrl)) {
                    pushUrl = `https://x-access-token:${encodeURIComponent(token)}@${originalUrl.slice("https://".length)}`;
                }

                const needsSwap = pushUrl !== originalUrl;
                if (needsSwap) {
                    const swap = await runShell(
                        sandboxId,
                        `git remote set-url ${shellQuote(remote)} ${shellQuote(pushUrl)}`,
                    );
                    if (swap.exitCode !== 0) {
                        return `Error configuring remote '${remote}': ${swap.stderr.trim() || swap.stdout.trim()}`;
                    }
                }

                let push: { exitCode: number; stdout: string; stderr: string };
                try {
                    push = await runShell(
                        sandboxId,
                        `git push -u ${shellQuote(remote)} ${refspec}`,
                    );
                } finally {
                    if (needsSwap) {
                        await runShell(
                            sandboxId,
                            `git remote set-url ${shellQuote(remote)} ${shellQuote(originalUrl)}`,
                        ).catch(() => undefined);
                    }
                }

                if (push.exitCode !== 0) {
                    const detail = sanitize(
                        push.stderr.trim() || push.stdout.trim(),
                        token,
                    );
                    return `Error pushing branch '${branch}' to '${remote}': ${detail}\nDo not call create_pull_request — the push must succeed first. Inspect the branch/remote/authentication state, fix the issue, and retry the push.`;
                }

                const remoteOutput = sanitize(
                    push.stdout.trim() || push.stderr.trim(),
                    token,
                );
                const warning = DEFAULT_BRANCHES.has(branch)
                    ? "\nWarning: this is a default branch ('main'/'master'). Pull Request work normally uses a dedicated feature/fix branch — continue only if the user explicitly asked to push this branch."
                    : "";
                // Record the push so create_pull_request can verify that this
                // run's file changes are actually on GitHub before opening a PR.
                workflow.pushedBranches.add(branch);
                workflow.writesAtLastPush = workflow.writeCount;
                return truncateOutput(
                    `Pushed branch '${branch}' to '${remote}' (upstream set). If a Pull Request was requested: create_pull_request may be called as the final step.${warning}\n${scrubSecretPatterns(remoteOutput)}`,
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return `Error pushing branch: ${scrubSecretPatterns(message)}`;
            }
        },
    };
}
