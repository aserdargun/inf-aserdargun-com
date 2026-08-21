import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const wait = (ms) => new Promise((resolveWait) => globalThis.setTimeout(resolveWait, ms));

async function identity(pid) {
  const { stdout } = await execFile("ps", ["-p", String(pid), "-o", "lstart="]);
  return stdout.trim();
}

async function ready() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await fetch("http://127.0.0.1:4280").then((response) => response.ok).catch(() => false)) return;
    await wait(50);
  }
  throw new Error("stubborn process did not bind 4280");
}

async function runStop() {
  const result = await new Promise((resolveResult, rejectResult) => {
    const child = spawn(process.execPath, ["scripts/stop-local.mjs"], { cwd: process.cwd(), stdio: "pipe" });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", rejectResult);
    child.on("exit", (code) => resolveResult({ code, output }));
  });
  assert.equal(result.code, 0, result.output);
}

test("Stop escalates a checkout-owned stubborn process group after the TERM grace period", { timeout: 12_000 }, async () => {
  const stubborn = spawn(process.execPath, ["-e", "const http=require('node:http'); process.on('SIGTERM',()=>{}); http.createServer((_,r)=>r.end('stubborn')).listen(4280,'127.0.0.1')"], {
    cwd: process.cwd(), detached: true, stdio: "ignore",
  });
  try {
    await ready();
    await mkdir(".codex/run", { recursive: true });
    await writeFile(".codex/run/inf-local.json", JSON.stringify({
      version: 2,
      checkout: process.cwd(),
      pids: [{ pid: stubborn.pid, startIdentity: await identity(stubborn.pid), group: true }],
    }));
    const started = Date.now();
    await runStop();
    assert.ok(Date.now() - started >= 4_500, "Stop must allow the documented TERM grace period before KILL");
    await new Promise((resolveExit, rejectExit) => {
      if (stubborn.exitCode !== null || stubborn.signalCode !== null) { resolveExit(); return; }
      const timeout = globalThis.setTimeout(() => rejectExit(new Error("stubborn group survived Stop")), 1_000);
      stubborn.once("exit", () => { globalThis.clearTimeout(timeout); resolveExit(); });
    });
    await assert.rejects(fetch("http://127.0.0.1:4280"));
  } finally {
    try { process.kill(-stubborn.pid, "SIGKILL"); } catch { /* already stopped */ }
    await rm(".codex/run/inf-local.json", { force: true });
  }
});
