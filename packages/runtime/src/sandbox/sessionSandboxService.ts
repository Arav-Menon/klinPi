import { Sandbox, createSandbox, sandboxManger } from "@klinpi/compute";
import { getDb, schema } from "@klinpi/db";
import { and, desc, eq } from "drizzle-orm";

const SANDBOX_TTL_MS = 30 * 60 * 1000;
const WORKSPACE_PATH = "/workspace";

type StatusCallback = (content: string) => void;

export interface EnsureSandboxParams {
    sessionId: string;
    /** When present the workspace is cloned from this repo; otherwise an empty workspace is prepared. */
    cloneUrl?: string;
    branch?: string;
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
        const { sessionId, cloneUrl, branch, onStatus } = params;
        const effectiveBranch = branch ?? "main";

        const reusedId = await this.refresh(sessionId);
        if (reusedId) {
            onStatus(`Reusing sandbox ${reusedId} — workspace preserved`);
            return reusedId;
        }

        const { sandbox, sandboxId } = await createSandbox();
        sandboxManger.registerSbx(sandbox);

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

        onStatus(
            cloneUrl
                ? `Cloning ${cloneUrl} (branch: ${effectiveBranch})...`
                : "Preparing workspace (no repository linked)...",
        );
        const prepareCommand = cloneUrl
            ? `sudo mkdir -p ${WORKSPACE_PATH} && sudo chown -R user ${WORKSPACE_PATH} && git clone --branch ${effectiveBranch} ${cloneUrl} ${WORKSPACE_PATH}`
            : `sudo mkdir -p ${WORKSPACE_PATH} && sudo chown -R user ${WORKSPACE_PATH}`;
        try {
            const result = await sandbox.commands.run(prepareCommand);
            if (result.exitCode !== 0) {
                throw new Error(result.stderr || `exit status ${result.exitCode}`);
            }
        } catch (error) {
            const stderr = (error as { stderr?: string }).stderr;
            const raw =
                (typeof stderr === "string" && stderr.trim()) ||
                (error instanceof Error ? error.message : String(error));
            const detail = cloneUrl
                ? raw.startsWith("Clone failed")
                    ? raw
                    : `Clone failed: ${raw}`
                : raw;
            console.error(`[Sandbox prepare] ${detail}`);
            try {
                await this.db
                    .update(schema.sandboxes)
                    .set({ status: "FAILED" })
                    .where(eq(schema.sandboxes.id, rowId));
            } catch (dbError) {
                console.error("[SessionSandbox] Failed to mark sandbox FAILED:", dbError);
            }
            throw new Error(detail);
        }

        try {
            await this.db
                .update(schema.sandboxes)
                .set({ status: "RUNNING", lastActiveAt: new Date() })
                .where(eq(schema.sandboxes.id, rowId));
        } catch (error) {
            console.error("[SessionSandbox] Failed to mark sandbox RUNNING:", error);
        }

        onStatus(cloneUrl ? "Repository cloned successfully" : "Workspace ready");
        return sandboxId;
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
