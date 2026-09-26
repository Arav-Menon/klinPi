import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDb, schema } from "@klinpi/db";
import { eq } from "drizzle-orm";

const computeMocks = vi.hoisted(() => ({
    connect: vi.fn(),
    create: vi.fn(),
    register: vi.fn(),
}));

vi.mock("@klinpi/compute", () => ({
    Sandbox: { connect: computeMocks.connect },
    createSandbox: computeMocks.create,
    sandboxManger: { registerSbx: computeMocks.register },
}));

import { sessionSandboxService } from "../../packages/runtime/src/sandbox/sessionSandboxService.js";

const TEST_USER_ID = "test-user-sbx-000";
const TEST_SESSION_ID = "test-session-sbx-000";
const CLONE_URL = "https://github.com/example/example.git";

async function insertSandboxRow(
    providerSandboxId: string,
    status: "RUNNING" | "CREATING" = "RUNNING",
    lastActiveAt: Date = new Date(),
) {
    const db = getDb();
    const [row] = await db
        .insert(schema.sandboxes)
        .values({
            sessionId: TEST_SESSION_ID,
            providerSandboxId,
            status,
            workspacePath: "/workspace",
            branchName: "main",
            lastActiveAt,
        })
        .returning({ id: schema.sandboxes.id });
    if (!row) throw new Error("failed to insert sandbox row");
    return row;
}

async function getSandboxRow(rowId: string) {
    const db = getDb();
    const rows = await db
        .select()
        .from(schema.sandboxes)
        .where(eq(schema.sandboxes.id, rowId));
    if (!rows[0]) throw new Error("sandbox row not found");
    return rows[0];
}

describe("SessionSandboxService", () => {
    beforeEach(async () => {
        computeMocks.connect.mockReset();
        computeMocks.create.mockReset();
        computeMocks.register.mockReset();

        const db = getDb();
        await db
            .insert(schema.users)
            .values({
                id: TEST_USER_ID,
                email: "sbx-test@klinpi.dev",
                name: "Sandbox Test User",
            })
            .onConflictDoNothing();
        await db
            .delete(schema.sandboxes)
            .where(eq(schema.sandboxes.sessionId, TEST_SESSION_ID));
        await db
            .insert(schema.agentSessions)
            .values({
                id: TEST_SESSION_ID,
                userId: TEST_USER_ID,
                title: "Sandbox reuse test",
            })
            .onConflictDoNothing();
    });

    afterEach(async () => {
        const db = getDb();
        await db
            .delete(schema.sandboxes)
            .where(eq(schema.sandboxes.sessionId, TEST_SESSION_ID));
    });

    describe("refresh", () => {
        it("should return null when the session has no running sandbox", async () => {
            const result = await sessionSandboxService.refresh(TEST_SESSION_ID);
            expect(result).toBeNull();
            expect(computeMocks.connect).not.toHaveBeenCalled();
        });

        it("should extend lifetime and reuse a live sandbox", async () => {
            const oldActivity = new Date(Date.now() - 60 * 60 * 1000);
            const row = await insertSandboxRow("sbx-live-1", "RUNNING", oldActivity);
            const fakeSandbox = {
                sandboxId: "sbx-live-1",
                setTimeout: vi.fn().mockResolvedValue(undefined),
            };
            computeMocks.connect.mockResolvedValue(fakeSandbox);

            const result = await sessionSandboxService.refresh(TEST_SESSION_ID);

            expect(result).toBe("sbx-live-1");
            expect(computeMocks.connect).toHaveBeenCalledWith("sbx-live-1");
            expect(fakeSandbox.setTimeout).toHaveBeenCalledWith(30 * 60 * 1000);
            expect(computeMocks.register).toHaveBeenCalledWith(fakeSandbox);

            const updated = await getSandboxRow(row.id);
            expect(updated.status).toBe("RUNNING");
            expect(updated.lastActiveAt!.getTime()).toBeGreaterThan(
                oldActivity.getTime(),
            );
        });

        it("should mark the row DESTROYED when the sandbox is gone", async () => {
            const row = await insertSandboxRow("sbx-dead-1", "RUNNING");
            computeMocks.connect.mockRejectedValue(new Error("sandbox not found"));

            const result = await sessionSandboxService.refresh(TEST_SESSION_ID);

            expect(result).toBeNull();

            const updated = await getSandboxRow(row.id);
            expect(updated.status).toBe("DESTROYED");
            expect(updated.destroyedAt).not.toBeNull();
        });
    });

    describe("ensure", () => {
        it("should reuse an existing sandbox without creating or cloning", async () => {
            const row = await insertSandboxRow("sbx-live-2", "RUNNING");
            const fakeSandbox = {
                sandboxId: "sbx-live-2",
                setTimeout: vi.fn().mockResolvedValue(undefined),
            };
            computeMocks.connect.mockResolvedValue(fakeSandbox);

            const statuses: string[] = [];
            const result = await sessionSandboxService.ensure({
                sessionId: TEST_SESSION_ID,
                cloneUrl: CLONE_URL,
                branch: "main",
                onStatus: (content) => statuses.push(content),
            });

            expect(result).toBe("sbx-live-2");
            expect(computeMocks.create).not.toHaveBeenCalled();
            expect(statuses.some((s) => s.startsWith("Reusing sandbox"))).toBe(true);

            const updated = await getSandboxRow(row.id);
            expect(updated.status).toBe("RUNNING");
        });

        it("should create, persist and clone when no sandbox exists", async () => {
            const sandboxId = `sbx-new-${crypto.randomUUID()}`;
            const fakeSandbox = {
                sandboxId,
                commands: {
                    run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" }),
                },
                kill: vi.fn(),
                setTimeout: vi.fn(),
            };
            computeMocks.create.mockResolvedValue({ sandbox: fakeSandbox, sandboxId });

            const statuses: string[] = [];
            const result = await sessionSandboxService.ensure({
                sessionId: TEST_SESSION_ID,
                cloneUrl: CLONE_URL,
                branch: "main",
                onStatus: (content) => statuses.push(content),
            });

            expect(result).toBe(sandboxId);
            expect(computeMocks.register).toHaveBeenCalledWith(fakeSandbox);

            const command = fakeSandbox.commands.run.mock.calls[0][0] as string;
            expect(command).toContain("sudo mkdir -p /workspace");
            expect(command).toContain(
                `git clone --branch main ${CLONE_URL} /workspace`,
            );

            expect(statuses).toContain(`Cloning ${CLONE_URL} (branch: main)...`);
            expect(statuses).toContain("Repository cloned successfully");

            const db = getDb();
            const rows = await db
                .select()
                .from(schema.sandboxes)
                .where(eq(schema.sandboxes.providerSandboxId, sandboxId));
            expect(rows).toHaveLength(1);
            expect(rows[0].status).toBe("RUNNING");
            expect(rows[0].sessionId).toBe(TEST_SESSION_ID);
            expect(rows[0].workspacePath).toBe("/workspace");
            expect(rows[0].branchName).toBe("main");
        });

        it("should mark the row FAILED and surface stderr when the clone fails", async () => {
            const sandboxId = `sbx-fail-${crypto.randomUUID()}`;
            const cloneError = Object.assign(new Error("exit status 128"), {
                stderr: "fatal: could not create work tree dir",
            });
            const fakeSandbox = {
                sandboxId,
                commands: { run: vi.fn().mockRejectedValue(cloneError) },
                kill: vi.fn(),
                setTimeout: vi.fn(),
            };
            computeMocks.create.mockResolvedValue({ sandbox: fakeSandbox, sandboxId });

            await expect(
                sessionSandboxService.ensure({
                    sessionId: TEST_SESSION_ID,
                    cloneUrl: CLONE_URL,
                    branch: "main",
                    onStatus: () => {},
                }),
            ).rejects.toThrow("Clone failed: fatal: could not create work tree dir");

            const db = getDb();
            const rows = await db
                .select()
                .from(schema.sandboxes)
                .where(eq(schema.sandboxes.providerSandboxId, sandboxId));
            expect(rows[0].status).toBe("FAILED");
        });
    });
});
