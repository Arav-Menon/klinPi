import { sandboxManger } from "./sandbox_manager/sandbox_manager.js";

async function runCmd() {
  const sandbox = await sandboxManger.getSbx();
  const result = await sandbox.commands.run("echo hello");
  console.log(result);
}

runCmd();
