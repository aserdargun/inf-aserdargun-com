import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const wait = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));
async function listenerReady() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch("http://127.0.0.1:4280").catch(() => undefined);
    if (response) return;
    await wait(50);
  }
  throw new Error("The temporary listener did not become ready.");
}
function listener(cwd) {
  return spawn(process.execPath, ["-e", "require('node:http').createServer((_, r) => r.end('ok')).listen(4280, '127.0.0.1')"], { cwd, stdio: "ignore" });
}
async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    wait(2_000).then(() => { throw new Error(`Temporary listener ${child.pid} did not exit.`); }),
  ]);
}
async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await waitForExit(child);
}
async function stop() {
  const child = spawn(process.execPath, ["scripts/stop-local.mjs"], { cwd: process.cwd(), stdio: "pipe" });
  const output = await new Promise((resolve, reject) => { let value = ""; child.stdout.on("data", (chunk) => { value += chunk; }); child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve(value) : reject(new Error(`stop exited ${code}`))); });
  return output;
}

test("safe stop is scoped, idempotent, and does not use broad process matching", async () => {
  const source = await readFile("scripts/stop-local.mjs", "utf8");
  assert.match(source, /lsof/);
  assert.match(source, /cwd/);
  assert.match(source, /SIGTERM/);
  assert.match(source, /SIGKILL/);
  assert.match(source, /process\.kill/);
  assert.match(source, /3000/);
  assert.match(source, /7071/);
  assert.match(source, /4280/);
  assert.doesNotMatch(source, /pkill|killall|lsof\s+-ti.*\|/i);
});

test("safe stop terminates an owned listener and refuses a foreign checkout listener", async () => {
  const owned = listener(process.cwd());
  try {
    await listenerReady();
    await stop();
    await waitForExit(owned);
  } finally { await terminate(owned); }

  const foreignDirectory = await mkdtemp(join(tmpdir(), "inf-foreign-listener-"));
  const foreign = listener(foreignDirectory);
  try {
    await listenerReady();
    const output = await stop();
    assert.match(output, /already stopped/);
    assert.equal(foreign.exitCode, null);
  } finally {
    await terminate(foreign);
    await rm(foreignDirectory, { recursive: true, force: true });
  }
});

test("safe stop refuses a reused recorded PID identity", async () => {
  const foreignDirectory = await mkdtemp(join(tmpdir(), "inf-reused-pid-"));
  const foreign = listener(foreignDirectory);
  try {
    await listenerReady();
    await mkdir(".codex/run", { recursive: true });
    await writeFile(".codex/run/inf-local.json", JSON.stringify({
      version: 2,
      checkout: process.cwd(),
      pids: [{ pid: foreign.pid, startIdentity: "Thu Jan  1 00:00:00 1970", group: false }],
    }));
    const output = await stop();
    assert.match(output, /already stopped/);
    assert.equal(foreign.exitCode, null);
  } finally {
    await rm(".codex/run/inf-local.json", { force: true });
    await terminate(foreign);
    await rm(foreignDirectory, { recursive: true, force: true });
  }
});

for (const [_label, control] of [
  ["malformed JSON", "{"],
  ["wrong checkout", JSON.stringify({ version: 2, checkout: "/tmp/not-this-checkout", pids: [{ pid: 1, startIdentity: "identity", group: false }] })],
  ["unsupported version", JSON.stringify({ version: 99, checkout: process.cwd(), pids: [{ pid: 1, startIdentity: "identity", group: false }] })],
]) {
test(`safe stop fails closed for ${_label} control state`, async () => {
  const foreignDirectory = await mkdtemp(join(tmpdir(), "inf-corrupt-control-"));
  const foreign = listener(foreignDirectory);
  try {
    await listenerReady();
    await mkdir(".codex/run", { recursive: true });
    await writeFile(".codex/run/inf-local.json", control);
    await assert.rejects(stop(), /stop exited/);
    assert.equal(foreign.exitCode, null);
  } finally {
    await rm(".codex/run/inf-local.json", { force: true });
    await terminate(foreign);
    await rm(foreignDirectory, { recursive: true, force: true });
  }
});
}
