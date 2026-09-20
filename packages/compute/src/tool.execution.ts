import { Sandbox } from "e2b";
import { sandboxManger } from "./sandbox_manager/sandbox_manager.js";

export async function readFile(sandboxId: string, path: string): Promise<string> {
    const sandbox = await sandboxManger.connectSbx(sandboxId);
    const content = await sandbox.files.read(path);
    return content;
}

export async function writeFile(sandboxId: string, path: string, content: string): Promise<void> {
    const sandbox = await sandboxManger.connectSbx(sandboxId);
    await sandbox.files.write(path, content);
}

export { Sandbox };