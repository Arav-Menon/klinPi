import { Sandbox } from "e2b";

export async function readFile(sandboxId: string, path: string): Promise<string> {
    const sandbox = await Sandbox.connect(sandboxId);
    const content = await sandbox.files.read(path);
    return content;
}

export { Sandbox };
