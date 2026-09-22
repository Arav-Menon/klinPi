import { Sandbox } from "e2b";
import { connectSandbox, createSandbox } from "./sandbox.js";

class SandboxManger {
    private sbx: Sandbox | null = null;
    private connectedSbx: Sandbox | null = null;

    async getSbx(): Promise<Sandbox> {
        if (this.sbx?.sandboxId) {
            return this.sbx;
        }

        console.log("[Sandbox] Creating...");

        const { sandbox } = await createSandbox();

        this.sbx = sandbox;

        console.log(
            `[Sandbox] Ready: ${sandbox.sandboxId}`,
        );

        return sandbox;
    }

    async connectSbx(sandboxId: string): Promise<Sandbox> {
        if (this.connectedSbx?.sandboxId) {
            return this.connectedSbx;
        }

        console.log("[Sandbox] connecting to sandbox...");

        const sandbox = await connectSandbox(sandboxId)

        this.connectedSbx = sandbox;

        console.log(
            `[Sandbox] Ready: ${sandboxId}`,
        );

        return sandbox

    }

    async destroySbx(): Promise<void> {
        if (this.sbx) {
            console.log(`[Sandbox] Destroying: ${this.sbx.sandboxId}`);
            await this.sbx.kill();
            this.sbx = null;
        }
        if (this.connectedSbx) {
            console.log(`[Sandbox] Disconnecting: ${this.connectedSbx.sandboxId}`);
            await this.connectedSbx.kill();
            this.connectedSbx = null;
        }
    }
}

export const sandboxManger = new SandboxManger();