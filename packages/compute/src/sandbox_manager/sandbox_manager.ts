import { Sandbox } from "e2b";
import { connectSandbox, createSandbox } from "./sandbox.js";

class SandboxManger {
    private readonly cache = new Map<string, Sandbox>();
    private defaultSbxId: string | null = null;

    async getSbx(): Promise<Sandbox> {
        if (this.defaultSbxId) {
            const cached = this.cache.get(this.defaultSbxId);
            if (cached) {
                return cached;
            }
        }

        console.log("[Sandbox] Creating...");

        const { sandbox } = await createSandbox();

        this.cache.set(sandbox.sandboxId, sandbox);
        this.defaultSbxId = sandbox.sandboxId;

        console.log(`[Sandbox] Ready: ${sandbox.sandboxId}`);

        return sandbox;
    }

    async connectSbx(sandboxId: string): Promise<Sandbox> {
        const cached = this.cache.get(sandboxId);
        if (cached) {
            return cached;
        }

        console.log("[Sandbox] connecting to sandbox...");

        const sandbox = await connectSandbox(sandboxId);

        this.cache.set(sandboxId, sandbox);

        console.log(`[Sandbox] Ready: ${sandboxId}`);

        return sandbox;
    }

    registerSbx(sandbox: Sandbox): void {
        this.cache.set(sandbox.sandboxId, sandbox);
    }

    async destroySbx(sandboxId?: string): Promise<void> {
        if (sandboxId) {
            const sandbox = this.cache.get(sandboxId);
            if (!sandbox) {
                return;
            }
            console.log(`[Sandbox] Destroying: ${sandboxId}`);
            await sandbox.kill();
            this.cache.delete(sandboxId);
            if (this.defaultSbxId === sandboxId) {
                this.defaultSbxId = null;
            }
            return;
        }

        for (const [id, sandbox] of [...this.cache]) {
            console.log(`[Sandbox] Destroying: ${id}`);
            try {
                await sandbox.kill();
            } catch {
                // Best-effort cleanup: keep destroying the rest
            }
            this.cache.delete(id);
            if (this.defaultSbxId === id) {
                this.defaultSbxId = null;
            }
        }
    }
}

export const sandboxManger = new SandboxManger();
