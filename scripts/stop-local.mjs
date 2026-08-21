import { execFile as execFileCallback } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { executeStop } from "./stop-local-core.mjs";

const execFile = promisify(execFileCallback);
const checkout = resolve(process.cwd());
const controlPath = resolve(checkout, ".codex/run/inf-local.json");
const configPath = resolve(checkout, ".codex/run/staticwebapp.local.json");
async function listenerPids(port) {
  try { const { stdout } = await execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]); return [...new Set(stdout.split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger))]; }
  catch (error) { if (error.code === 1) return []; throw error; }
}
async function cwdFor(pid) {
  try { const { stdout } = await execFile("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]); return stdout.split("\n").find((line) => line.startsWith("n"))?.slice(1); }
  catch { return undefined; }
}
async function startIdentityFor(pid) {
  try { const { stdout } = await execFile("ps", ["-p", String(pid), "-o", "lstart="]); return stdout.trim() || undefined; }
  catch { return undefined; }
}
async function isAlive(pid) {
  try { const { stdout } = await execFile("ps", ["-p", String(pid), "-o", "stat="]); const state = stdout.trim(); return state.length > 0 && !state.startsWith("Z"); }
  catch { return false; }
}
async function readControl() {
  try { return JSON.parse(await readFile(controlPath, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return undefined; throw error; }
}
const result = await executeStop({
  checkout, controlPath, configPath, ports: [3000, 7071, 7072, 4280], readControl, listenerPids, cwdFor, startIdentityFor,
  isAlive,
  signal: (pid, signal) => process.kill(pid, signal),
  delay: (ms) => new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, ms)), now: () => Date.now(),
  remove: (path) => rm(path, { force: true }),
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.code;
