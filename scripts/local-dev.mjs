import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const checkout = resolve(process.cwd());
const runDirectory = resolve(checkout, ".codex/run");
const controlPath = resolve(runDirectory, "inf-local.json");
const configPath = resolve(runDirectory, "staticwebapp.local.json");
const nextEnvPath = resolve(checkout, "next-env.d.ts");
const execFile = promisify(execFileCallback);
const originalNextEnv = await readFile(nextEnvPath, "utf8");
const token = randomBytes(32).toString("base64url");
const env = { ...process.env,
  INF_ALLOWED_GITHUB_USER: "aserdargun",
  INF_LOCAL_AUTH_BYPASS: "true",
  INF_LOCAL_RUNTIME: "development",
  INF_LOCAL_PROXY_MODE: "bypass",
  INF_LOCAL_PROXY_TOKEN: token,
  INF_LOCAL_STORAGE_MODE: "true",
  INF_LOCAL_STORAGE_ROOT: resolve(runDirectory, "storage"),
  INF_LOCAL_FUNCTIONS_PORT: "7071",
  INF_LOCAL_API_PROXY_PORT: "7072",
  INF_LOCAL_STATIC_ROOT: resolve(checkout, "out"),
  INF_LOCAL_WEB_PORT: "3000",
};
delete env.WEBSITE_SITE_NAME;

async function prepare() {
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  await chmod(runDirectory, 0o700);
  const productionConfig = JSON.parse(await readFile(resolve(checkout, "public/staticwebapp.config.json"), "utf8"));
  for (const route of productionConfig.routes) if (route.allowedRoles?.includes("authenticated")) route.allowedRoles = ["anonymous"];
  await writeFile(configPath, JSON.stringify(productionConfig), { mode: 0o600 });
}

function child(command, args, options = {}) {
  // Each service gets its own process group. This lets local Stop terminate the
  // actual server descendants (Next/SWA), rather than merely their pnpm shim.
  const processChild = spawn(command, args, { cwd: checkout, detached: true, env, stdio: "inherit", ...options });
  processChild.on("exit", (code, signal) => {
    if (!stopping && code !== 0) { console.error(`${command} exited (${signal ?? code}).`); void shutdown(1); }
  });
  return processChild;
}

async function startIdentity(pid) {
  const { stdout } = await execFile("ps", ["-p", String(pid), "-o", "lstart="]);
  const value = stdout.trim();
  if (!value) throw new Error(`Could not record start identity for PID ${pid}.`);
  return value;
}

const children = [];
let stopping = false;
let finish;
const finished = new Promise((resolveFinished) => { finish = resolveFinished; });
const waitForExit = (processChild) => processChild.exitCode !== null || processChild.signalCode !== null
  ? Promise.resolve()
  : new Promise((resolveExit) => processChild.once("exit", resolveExit));
async function shutdown(exitCode = 0) {
  if (stopping) return finished;
  stopping = true;
  for (const processChild of children) {
    if (processChild.exitCode !== null || processChild.signalCode !== null) continue;
    try { process.kill(-processChild.pid, "SIGTERM"); } catch { processChild.kill("SIGTERM"); }
  }
  await Promise.all(children.map(waitForExit));
  await rm(controlPath, { force: true });
  await rm(configPath, { force: true });
  await writeFile(nextEnvPath, originalNextEnv);
  finish(exitCode);
  return finished;
}

await prepare();
if (env.INF_LOCAL_SKIP_API_BUILD !== "true") {
  const build = child("pnpm", ["api:build"]);
  await new Promise((resolveBuild, rejectBuild) => build.once("exit", (code) => code === 0 ? resolveBuild() : rejectBuild(new Error("API build failed."))));
}
const next = env.INF_LOCAL_WEB_ARTIFACT === "out"
  ? child("node", ["scripts/local-static-host.mjs"])
  : child("pnpm", ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", "3000"]);
const functions = child("node", ["scripts/local-functions-host.mjs"]);
const proxy = child("node", ["scripts/local-api-proxy.mjs"]);
const swa = child("pnpm", ["exec", "swa", "start", "http://127.0.0.1:3000", "--api-devserver-url", "http://127.0.0.1:7072", "--host", "127.0.0.1", "--port", "4280", "--swa-config-location", runDirectory]);
children.push(next, functions, proxy, swa);
const pids = [{
  pid: process.pid,
  startIdentity: await startIdentity(process.pid),
  group: false,
}, ...await Promise.all(children.map(async (processChild) => ({
  pid: processChild.pid,
  startIdentity: await startIdentity(processChild.pid),
  group: true,
})))];
await writeFile(controlPath, JSON.stringify({ version: 2, checkout, pids, createdAt: new Date().toISOString() }), { mode: 0o600 });
console.log("INF local app is starting at http://127.0.0.1:4280 (owner auth is proxy-protected).\n");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void shutdown(); });
process.exitCode = await finished;
