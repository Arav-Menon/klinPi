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

export async function listDir(sandboxId: string, path: string): Promise<string> {
    const sandbox = await sandboxManger.connectSbx(sandboxId);
    const entries = await sandbox.files.list(path);
    if (entries.length === 0) {
        return "(empty)";
    }
    return entries
        .map((entry) =>
            entry.type === "dir" ? `${entry.name}/` : `${entry.name} (${entry.size} bytes)`,
        )
        .join("\n");
}

export { Sandbox };