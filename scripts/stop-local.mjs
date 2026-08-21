import { readFile, rm } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const checkout = resolve(process.cwd());
const controlPath = resolve(checkout, ".codex/run/inf-local.json");
const ports = [3000, 7071, 7072, 4280];
const delay = (ms) => new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, ms));
const insideCheckout = (value) => { const result = relative(checkout, resolve(value)); return result === "" || (!result.startsWith("..") && !result.startsWith("/")); };

async function listenerPids(port) {
  try {
    const { stdout } = await execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
    return [...new Set(stdout.split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger))];
  } catch (error) {
    if (error.code === 1) return [];
    throw error;
  }
}

async function cwdFor(pid) {
  try {
    const { stdout } = await execFile("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
    return stdout.split("\n").find((line) => line.startsWith("n"))?.slice(1);
  } catch { return undefined; }
}

async function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function controlPids() {
  try {
    const parsed = JSON.parse(await readFile(controlPath, "utf8"));
    return Array.isArray(parsed.pids) ? parsed.pids.filter(Number.isInteger) : [];
  } catch { return []; }
}

const candidates = new Set([...(await controlPids()), ...(await Promise.all(ports.map(listenerPids))).flat()]);
const owned = [];
for (const pid of candidates) {
  const cwd = await cwdFor(pid);
  if (cwd && insideCheckout(cwd)) owned.push(pid);
  else if (cwd) console.error(`Refusing to stop PID ${pid}: cwd ${cwd} is outside ${basename(checkout)}.`);
}

if (owned.length === 0) {
  console.log("INF local services are already stopped.");
  await rm(controlPath, { force: true });
  process.exit(0);
}

for (const pid of owned) { try { process.kill(pid, "SIGTERM"); } catch { /* A concurrent graceful exit is already safe. */ } }
const deadline = Date.now() + 5_000;
while (Date.now() < deadline && (await Promise.all(owned.map(isAlive))).some(Boolean)) await delay(100);
for (const pid of owned) {
  if (await isAlive(pid)) {
    const cwd = await cwdFor(pid);
    if (cwd && insideCheckout(cwd)) { try { process.kill(pid, "SIGKILL"); } catch { /* The exact verified process has already exited. */ } }
  }
}
await rm(controlPath, { force: true });
console.log(`Stopped ${owned.length} checkout-owned INF local process${owned.length === 1 ? "" : "es"}.`);
