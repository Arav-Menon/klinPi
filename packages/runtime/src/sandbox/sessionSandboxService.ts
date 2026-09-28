import { Sandbox, createSandbox, sandboxManger } from "@klinpi/compute";
import { getDb, schema } from "@klinpi/db";
import { and, desc, eq } from "drizzle-orm";

const SANDBOX_TTL_MS = 30 * 60 * 1000;
const WORKSPACE_PATH = "/workspace";

type StatusCallback = (content: string) => void;

export interface EnsureSandboxParams {
    sessionId: string;
    userId?: string | undefined;
    repositoryId?: string | undefined;
    /** When present the workspace is cloned from this repo; otherwise an empty workspace is prepared. */
    cloneUrl?: string | undefined;
    branch?: string | undefined;
    onStatus: StatusCallback;
}

export interface PrepareRepositoryParams {
    sessionId: string;
    /** Provider sandbox id (as stored in Sandbox.providerSandboxId). */
    sandboxId: string;
    userId?: string | undefined;
    repositoryId?: string | undefined;
    cloneUrl: string;
    branch?: string | undefined;
    onStatus: StatusCallback;
}

export class SessionSandboxService {
    private readonly db = getDb();

    async refresh(sessionId: string): Promise<string | null> {
        const row = await this.findRunning(sessionId);
        if (!row) {
            return null;
        }

        let sandbox: Sandbox;
        try {
            sandbox = await Sandbox.connect(row.providerSandboxId);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(
                `[SessionSandbox] Existing sandbox ${row.providerSandboxId} is unavailable (${message}), marking DESTROYED`,
            );
            try {
                await this.db
                    .update(schema.sandboxes)
                    .set({ status: "DESTROYED", destroyedAt: new Date() })
                    .where(eq(schema.sandboxes.id, row.id));
            } catch (dbError) {
                console.error("[SessionSandbox] Failed to mark sandbox DESTROYED:", dbError);
            }
            return null;
        }

        try {
            await sandbox.setTimeout(SANDBOX_TTL_MS);
        } catch (error) {
            console.warn(
                "[SessionSandbox] Failed to extend sandbox lifetime:",
                error instanceof Error ? error.message : error,
            );
        }

        try {
            await this.db
                .update(schema.sandboxes)
                .set({ lastActiveAt: new Date() })
                .where(eq(schema.sandboxes.id, row.id));
        } catch (error) {
            console.warn(
                "[SessionSandbox] Failed to update lastActiveAt:",
                error instanceof Error ? error.message : error,
            );
        }

        sandboxManger.registerSbx(sandbox);
        return sandbox.sandboxId;
    }

    async ensure(params: EnsureSandboxParams): Promise<string> {
        const { sessionId, userId, repositoryId, cloneUrl, branch, onStatus } = params;
        const effectiveBranch = branch ?? "main";

        const reusedId = await this.refresh(sessionId);
        if (reusedId) {
            onStatus(`Reusing sandbox ${reusedId} — workspace preserved`);
            if (cloneUrl) {
                await this.prepareRepository({
                    sessionId,
                    sandboxId: reusedId,
                    userId,
                    repositoryId,
                    cloneUrl,
                    branch,
                    onStatus,
                });
            }
            return reusedId;
        }

        const { sandbox, sandboxId } = await createSandbox();
        sandboxManger.registerSbx(sandbox);
        console.log(
            `[SessionSandbox] action=create sessionId=${sessionId} sandboxId=${sandboxId} workspace=${WORKSPACE_PATH} repositoryId=${repositoryId ?? "none"} repo=${cloneUrl ?? "none"} branch=${cloneUrl ? effectiveBranch : "-"}`,
        );

        let rowId: string;
        try {
            const [row] = await this.db
                .insert(schema.sandboxes)
                .values({
                    sessionId,
                    providerSandboxId: sandboxId,
                    status: "CREATING",
                    workspacePath: WORKSPACE_PATH,
                    branchName: cloneUrl ? effectiveBranch : null,
                    lastActiveAt: new Date(),
                })
                .returning({ id: schema.sandboxes.id });
            if (!row) {
                throw new Error("Sandbox insert returned no row");
            }
            rowId = row.id;
        } catch (error) {
            console.error("[SessionSandbox] Failed to persist sandbox row:", error);
            try {
                await sandbox.kill();
            } catch {
                // Best-effort cleanup of the orphan sandbox
            }
            throw error;
        }

        try {
            await this.runPrepare(sandbox, {
                sessionId,
                sandboxId,
                userId,
                cloneUrl,
                branch,
                onStatus,
            });
        } catch (error) {
            try {
                await this.db
                    .update(schema.sandboxes)
                    .set({ status: "FAILED" })
                    .where(eq(schema.sandboxes.id, rowId));
            } catch (dbError) {
                console.error("[SessionSandbox] Failed to mark sandbox FAILED:", dbError);
            }
            throw error;
        }

        try {
            await this.db
                .update(schema.sandboxes)
                .set({ status: "RUNNING", lastActiveAt: new Date() })
                .where(eq(schema.sandboxes.id, rowId));
        } catch (error) {
            console.error("[SessionSandbox] Failed to mark sandbox RUNNING:", error);
        }

        return sandboxId;
    }

    async prepareRepository(params: PrepareRepositoryParams): Promise<void> {
        const { sessionId, sandboxId, userId, repositoryId, cloneUrl, branch, onStatus } = params;
        const effectiveBranch = branch ?? "main";

        let sandbox: Sandbox;
        try {
            sandbox = await Sandbox.connect(sandboxId);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Sandbox ${sandboxId} is unavailable (${message})`);
        }

        let checkOutput = "";
        try {
            const check = await sandbox.commands.run(
                `test -d ${WORKSPACE_PATH}/.git && echo HAS_REPO || echo NO_REPO`,
            );
            checkOutput = String(check.stdout ?? "");
        } catch {
            checkOutput = "";
        }

        if (checkOutput.includes("HAS_REPO")) {
            console.log(
                `[SessionSandbox] action=prepare-reuse sessionId=${sessionId} sandboxId=${sandboxId} workspace=${WORKSPACE_PATH} repositoryId=${repositoryId ?? "none"} repo=${cloneUrl} branch=${effectiveBranch} — repository already present`,
            );
            return;
        }

        console.log(
            `[SessionSandbox] action=prepare-reuse sessionId=${sessionId} sandboxId=${sandboxId} workspace=${WORKSPACE_PATH} repositoryId=${repositoryId ?? "none"} repo=${cloneUrl} branch=${effectiveBranch} — repository missing, cloning`,
        );
        await this.runPrepare(sandbox, {
            sessionId,
            sandboxId,
            userId,
            cloneUrl,
            branch,
            onStatus,
        });

        try {
            await this.db
                .update(schema.sandboxes)
                .set({
                    branchName: effectiveBranch,
                    status: "RUNNING",
                    lastActiveAt: new Date(),
                })
                .where(
                    and(
                        eq(schema.sandboxes.sessionId, sessionId),
                        eq(schema.sandboxes.providerSandboxId, sandboxId),
                    ),
                );
        } catch (error) {
            console.warn(
                "[SessionSandbox] Failed to update sandbox row after repository prepare:",
                error instanceof Error ? error.message : error,
            );
        }
    }

    private async runPrepare(
        sandbox: Sandbox,
        params: {
            sessionId: string;
            sandboxId: string;
            userId?: string | undefined;
            cloneUrl?: string | undefined;
            branch?: string | undefined;
            onStatus: StatusCallback;
        },
    ): Promise<void> {
        const { sessionId, sandboxId, userId, cloneUrl, branch, onStatus } = params;
        const effectiveBranch = branch ?? "main";
        onStatus(
            cloneUrl
                ? `Cloning ${cloneUrl} (branch: ${effectiveBranch})...`
                : "Preparing workspace (no repository linked)...",
        );

        const { command, secret } = await this.buildPrepareCommand(
            cloneUrl,
            effectiveBranch,
            userId,
        );
        try {
            const result = await sandbox.commands.run(command);
            if (result.exitCode !== 0) {
                throw new Error(result.stderr || `exit status ${result.exitCode}`);
            }
        } catch (error) {
            const stderr = (error as { stderr?: string }).stderr;
            const raw =
                (typeof stderr === "string" && stderr.trim()) ||
                (error instanceof Error ? error.message : String(error));
            const safe = this.sanitize(raw, secret);
            const detail = cloneUrl
                ? safe.startsWith("Clone failed")
                    ? safe
                    : `Clone failed: ${safe}`
                : safe;
            console.error(
                `[SessionSandbox] action=prepare-failed sessionId=${sessionId} sandboxId=${sandboxId} workspace=${WORKSPACE_PATH} repo=${cloneUrl ?? "none"} error=${detail}`,
            );
            throw new Error(detail);
        }

        console.log(
            `[SessionSandbox] action=prepare-ok sessionId=${sessionId} sandboxId=${sandboxId} workspace=${WORKSPACE_PATH} repo=${cloneUrl ?? "none"} branch=${cloneUrl ? effectiveBranch : "-"}`,
        );
        onStatus(cloneUrl ? "Repository cloned successfully" : "Workspace ready");
    }

    private async buildPrepareCommand(
        cloneUrl: string | undefined,
        effectiveBranch: string,
        userId?: string | undefined,
    ): Promise<{ command: string; secret?: string | undefined }> {
        if (!cloneUrl) {
            return {
                command: `sudo mkdir -p ${WORKSPACE_PATH} && sudo chown -R user ${WORKSPACE_PATH}`,
            };
        }

        let url = cloneUrl;
        let secret: string | undefined;
        if (/^https:\/\/github\.com\/.+/.test(cloneUrl) && userId) {
            try {
                const rows = await this.db
                    .select({ accessToken: schema.oauthAccounts.accessToken })
                    .from(schema.oauthAccounts)
                    .where(
                        and(
                            eq(schema.oauthAccounts.userId, userId),
                            eq(schema.oauthAccounts.provider, "github"),
                        ),
                    )
                    .limit(1);
                const token = rows[0]?.accessToken;
                if (token) {
                    secret = token;
                    url = `https://x-access-token:${encodeURIComponent(token)}@${cloneUrl.slice("https://".length)}`;
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.warn(
                    `[SessionSandbox] GitHub credential lookup failed, cloning without auth: ${this.sanitize(message, secret)}`,
                );
            }
        }

        return {
            command: `sudo mkdir -p ${WORKSPACE_PATH} && sudo chown -R user ${WORKSPACE_PATH} && git clone --branch ${effectiveBranch} ${url} ${WORKSPACE_PATH}`,
            secret,
        };
    }

    private sanitize(text: string, secret?: string | undefined): string {
        let out = text.replace(/x-access-token:[^@\s]*@/g, "x-access-token:***@");
        if (secret) {
            out = out.split(secret).join("***");
            const encoded = encodeURIComponent(secret);
            if (encoded !== secret) {
                out = out.split(encoded).join("***");
            }
        }
        return out;
    }

    private async findRunning(sessionId: string) {
        const rows = await this.db
            .select()
            .from(schema.sandboxes)
            .where(
                and(
                    eq(schema.sandboxes.sessionId, sessionId),
                    eq(schema.sandboxes.status, "RUNNING"),
                ),
            )
            .orderBy(desc(schema.sandboxes.createdAt))
            .limit(1);
        return rows[0] ?? null;
    }
}

export const sessionSandboxService = new SessionSandboxService();
