import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const checkout = resolve(process.cwd());
const runDirectory = resolve(checkout, ".codex/run");
const controlPath = resolve(runDirectory, "inf-local.json");
const configPath = resolve(runDirectory, "staticwebapp.local.json");
const token = randomBytes(32).toString("base64url");
const env = { ...process.env,
  INF_ALLOWED_GITHUB_USER: "aserdargun",
  INF_LOCAL_AUTH_BYPASS: "true",
  INF_LOCAL_PROXY_MODE: "bypass",
  INF_LOCAL_PROXY_TOKEN: token,
  INF_LOCAL_STORAGE_MODE: "true",
  INF_LOCAL_STORAGE_ROOT: resolve(runDirectory, "storage"),
  INF_LOCAL_FUNCTIONS_PORT: "7071",
  INF_LOCAL_API_PROXY_PORT: "7072",
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
  const processChild = spawn(command, args, { cwd: checkout, env, stdio: "inherit", ...options });
  processChild.on("exit", (code, signal) => {
    if (!stopping && code !== 0) { console.error(`${command} exited (${signal ?? code}).`); void shutdown(1); }
  });
  return processChild;
}

const children = [];
let stopping = false;
async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const processChild of children) if (!processChild.killed) processChild.kill("SIGTERM");
  await Promise.all(children.map((processChild) => new Promise((resolveExit) => processChild.once("exit", resolveExit))));
  await rm(controlPath, { force: true });
  process.exit(exitCode);
}

await prepare();
const build = child("pnpm", ["api:build"]);
await new Promise((resolveBuild, rejectBuild) => build.once("exit", (code) => code === 0 ? resolveBuild() : rejectBuild(new Error("API build failed."))));
const next = child("pnpm", ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", "3000"]);
const functions = child("node", ["scripts/local-functions-host.mjs"]);
const proxy = child("node", ["scripts/local-api-proxy.mjs"]);
const swa = child("pnpm", ["exec", "swa", "start", "http://127.0.0.1:3000", "--api-devserver-url", "http://127.0.0.1:7072", "--host", "127.0.0.1", "--port", "4280", "--swa-config-location", runDirectory]);
children.push(next, functions, proxy, swa);
await writeFile(controlPath, JSON.stringify({ version: 1, checkout, pids: children.map((processChild) => processChild.pid), createdAt: new Date().toISOString() }), { mode: 0o600 });
console.log("INF local app is starting at http://127.0.0.1:4280 (owner auth is proxy-protected).\n");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void shutdown(); });
await new Promise(() => {});
