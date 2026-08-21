import { readFile, rm } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const checkout = resolve(process.cwd());
const controlPath = resolve(checkout, ".codex/run/inf-local.json");
const configPath = resolve(checkout, ".codex/run/staticwebapp.local.json");
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

async function startIdentityFor(pid) {
  try {
    const { stdout } = await execFile("ps", ["-p", String(pid), "-o", "lstart="]);
    return stdout.trim() || undefined;
  } catch { return undefined; }
}

async function controlPids() {
  try {
    const parsed = JSON.parse(await readFile(controlPath, "utf8"));
    if (parsed.version !== 2 || parsed.checkout !== checkout || !Array.isArray(parsed.pids) || parsed.pids.length === 0) throw new Error("invalid control schema");
    const records = parsed.pids.map((entry) => {
      if (!entry || !Number.isInteger(entry.pid) || entry.pid < 1 || typeof entry.startIdentity !== "string" || !entry.startIdentity || typeof entry.group !== "boolean") throw new Error("invalid control process");
      return { pid: entry.pid, startIdentity: entry.startIdentity, group: entry.group };
    });
    if (new Set(records.map((entry) => entry.pid)).size !== records.length) throw new Error("duplicate control process");
    return records;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw new Error(`Refusing to stop with corrupt local control state: ${error?.message ?? "unknown error"}`);
  }
}

const recorded = await controlPids();
const expectedIdentity = new Map(recorded.map((entry) => [entry.pid, entry.startIdentity]));
const candidates = new Set([...expectedIdentity.keys(), ...(await Promise.all(ports.map(listenerPids))).flat()]);
const owned = [];
for (const pid of candidates) {
  const expected = expectedIdentity.get(pid) ?? await startIdentityFor(pid);
  const actualIdentity = await startIdentityFor(pid);
  if (!expected || actualIdentity !== expected) {
    console.error(`Refusing to stop PID ${pid}: recorded identity no longer matches.`);
    continue;
  }
  const cwd = await cwdFor(pid);
  if (cwd && insideCheckout(cwd)) owned.push({ pid, startIdentity: expected, group: recorded.find((entry) => entry.pid === pid)?.group === true });
  else if (cwd) console.error(`Refusing to stop PID ${pid}: cwd ${cwd} is outside ${basename(checkout)}.`);
}

if (owned.length === 0) {
  console.log("INF local services are already stopped.");
  await rm(controlPath, { force: true });
  await rm(configPath, { force: true });
  process.exit(0);
}

for (const processRecord of owned) {
  try {
    if (await startIdentityFor(processRecord.pid) !== processRecord.startIdentity || !insideCheckout(await cwdFor(processRecord.pid) ?? "")) continue;
    if (processRecord.group) process.kill(-processRecord.pid, "SIGTERM");
    else process.kill(processRecord.pid, "SIGTERM");
  } catch { /* A concurrent graceful exit is already safe. */ }
}
const deadline = Date.now() + 5_000;
while (Date.now() < deadline && (await Promise.all(owned.map((entry) => isAlive(entry.pid)))).some(Boolean)) await delay(100);
for (const processRecord of owned) {
  if (await isAlive(processRecord.pid)) {
    const sameIdentity = !processRecord.startIdentity || await startIdentityFor(processRecord.pid) === processRecord.startIdentity;
    const cwd = await cwdFor(processRecord.pid);
    if (sameIdentity && cwd && insideCheckout(cwd)) {
      try {
        if (processRecord.group) process.kill(-processRecord.pid, "SIGKILL");
        else process.kill(processRecord.pid, "SIGKILL");
      } catch { /* The exact verified process has already exited. */ }
    }
  }
}
await rm(controlPath, { force: true });
await rm(configPath, { force: true });
console.log(`Stopped ${owned.length} checkout-owned INF local process${owned.length === 1 ? "" : "es"}.`);
