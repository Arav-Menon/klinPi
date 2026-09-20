
import { Sandbox } from "e2b";
import { E2B_API_KEY } from "../env.js";

if (!E2B_API_KEY) {
    throw new Error("E2B_API_KEY is not configured");
}

const SANDBOX_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const MAX_CREATE_RETRIES = 3;

export interface CreateSandboxOptions {
    timeoutMs?: number;
}

export interface SandboxInstance {
    sandbox: Sandbox;
    sandboxId: string;
}

async function createSandbox(
    options: CreateSandboxOptions = {},
): Promise<SandboxInstance> {
    const timeoutMs = options.timeoutMs ?? SANDBOX_TIMEOUT;
    let lastCreateError: unknown;

    for (let attempt = 1; attempt <= MAX_CREATE_RETRIES; attempt++) {
        try {
            console.log(
                `[Sandbox] Creating sandbox... attempt=${attempt}`,
            );

            const sandbox = await Sandbox.create({
                apiKey: E2B_API_KEY,
                timeoutMs,
            });
            console.log(
                `[Sandbox] Created successfully id=${sandbox.sandboxId}`,
            );

            return {
                sandbox,
                sandboxId: sandbox.sandboxId,
            };
        } catch (error) {
            lastCreateError = error;

            console.error(
                `[Sandbox] Creation failed attempt=${attempt}`,
                error,
            );

            if (attempt < MAX_CREATE_RETRIES) {
                const delay = attempt * 1000;

                await new Promise((resolve) =>
                    setTimeout(resolve, delay),
                );
            }
        }
    }

    throw new Error(
        `Failed to create sandbox after ${MAX_CREATE_RETRIES} attempts`,
        {
            cause: lastCreateError,
        },
    );
}

async function connectSandbox(sandboxId: string): Promise<Sandbox> {
    let lastConnectError: unknown;

    for (let attempt = 1; attempt <= MAX_CREATE_RETRIES; attempt++) {
        try {
            console.log(
                `[Sandbox] Connecting to sandbox... attempt=${attempt}`,
            );

            const sandbox = await Sandbox.connect(sandboxId);

            console.log(
                `[Sandbox] Connected successfully id=${sandbox.sandboxId}`,
            );

            return sandbox;
        } catch (error) {
            lastConnectError = error;

            console.error(
                `[Sandbox] Connection failed attempt=${attempt}`,
                error,
            );

            if (attempt < MAX_CREATE_RETRIES) {
                const delay = attempt * 1000;

                await new Promise((resolve) =>
                    setTimeout(resolve, delay),
                );
            }
        }
    }

    throw new Error(
        `Failed to connect to sandbox '${sandboxId}' after ${MAX_CREATE_RETRIES} attempts`,
        {
            cause: lastConnectError,
        },
    );
}

export { createSandbox, connectSandbox }