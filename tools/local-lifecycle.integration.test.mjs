import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ports = [3000, 7071, 7072, 4280];
const delay = (ms) => new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, ms));

async function waitFor(check, description) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await check().catch(() => undefined);
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function run(command, args) {
  const processChild = spawn(command, args, { cwd: process.cwd(), env: { ...process.env, INF_LOCAL_SKIP_API_BUILD: "true" }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  processChild.stdout.on("data", (chunk) => { output += chunk; });
  processChild.stderr.on("data", (chunk) => { output += chunk; });
  const code = await new Promise((resolveRun, rejectRun) => {
    processChild.on("error", rejectRun);
    processChild.on("exit", resolveRun);
  });
  return { code, output };
}

async function noListeners() {
  for (const port of ports) {
    try {
      const { stdout } = await execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
      if (stdout.trim()) return false;
    } catch (error) {
      if (error.code !== 1) throw error;
    }
  }
  return true;
}

test("real local Run reaches compiled handlers and Stop reaps the complete loopback tree", { timeout: 60_000 }, async () => {
  await run(process.execPath, ["scripts/stop-local.mjs"]);
  const beforeNextEnv = await readFile("next-env.d.ts", "utf8");
  const beforeStatus = (await execFile("git", ["status", "--porcelain", "--", "next-env.d.ts"])).stdout;
  const local = spawn(process.execPath, ["scripts/local-dev.mjs"], {
    cwd: process.cwd(), env: { ...process.env, INF_LOCAL_SKIP_API_BUILD: "true" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let localOutput = "";
  local.stdout.on("data", (chunk) => { localOutput += chunk; });
  local.stderr.on("data", (chunk) => { localOutput += chunk; });
  try {
    const owner = await waitFor(async () => {
      const response = await fetch("http://127.0.0.1:4280/api/session");
      return response.status === 200 ? response : undefined;
    }, "owner session through SWA/proxy/functions");
    assert.deepEqual(await owner.json(), { authenticated: true, owner: "aserdargun", mode: "local-bypass" });
    const direct = await fetch("http://127.0.0.1:7071/api/session");
    assert.equal(direct.status, 403);
    const wrongCapability = await fetch("http://127.0.0.1:7071/api/session", { headers: { "x-inf-local-proxy-token": "wrong" } });
    assert.equal(wrongCapability.status, 403);
    const publicCatalog = await fetch("http://127.0.0.1:4280/api/public/infographics");
    assert.equal(publicCatalog.status, 200);
    assert.match(publicCatalog.headers.get("cache-control") ?? "", /public/);
    const ownerCatalog = await fetch("http://127.0.0.1:4280/api/infographics");
    assert.equal(ownerCatalog.status, 200);
    for (const port of ports) {
      const { stdout } = await execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-F", "n"]);
      assert.match(stdout, /n127\.0\.0\.1:/, `port ${port} must be loopback-only`);
      assert.doesNotMatch(stdout, /n\*:/, `port ${port} must not be wildcard-bound`);
    }
  } finally {
    const stopped = await run(process.execPath, ["scripts/stop-local.mjs"]);
    assert.equal(stopped.code, 0, stopped.output);
  }
  await Promise.race([
    new Promise((resolveExit) => {
      if (local.exitCode !== null) { resolveExit(); return; }
      local.once("exit", resolveExit);
    }),
    delay(6_000).then(() => { throw new Error(`foreground Run did not exit cleanly\n${localOutput}`); }),
  ]);
  assert.equal(local.exitCode, 0, localOutput);
  assert.equal(await noListeners(), true);
  await assert.rejects(access(".codex/run/inf-local.json"));
  await assert.rejects(access(".codex/run/staticwebapp.local.json"));
  assert.equal(await readFile("next-env.d.ts", "utf8"), beforeNextEnv);
  assert.equal((await execFile("git", ["status", "--porcelain", "--", "next-env.d.ts"])).stdout, beforeStatus);
  await rm(".codex/run", { recursive: true, force: true });
});
