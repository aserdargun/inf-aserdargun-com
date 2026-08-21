import { spawn } from "node:child_process";
import { once } from "node:events";

const local = spawn(process.execPath, ["scripts/local-dev.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, INF_LOCAL_SKIP_API_BUILD: "true" },
  stdio: "inherit",
});
let stopping = false;

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  const cleaner = spawn(process.execPath, ["scripts/stop-local.mjs"], { cwd: process.cwd(), stdio: "inherit" });
  await once(cleaner, "exit");
  if (local.exitCode === null && local.signalCode === null) await once(local, "exit");
  process.exit(exitCode);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void stop(); });
local.on("exit", (code) => { if (!stopping) void stop(code ?? 1); });
