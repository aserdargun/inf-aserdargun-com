import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ports = [3000, 7071, 7072, 4280];
const wait = (ms) => new Promise((resolveWait) => globalThis.setTimeout(resolveWait, ms));

async function ready() {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (await fetch("http://127.0.0.1:4280/api/session").then((response) => response.status === 200).catch(() => false)) return;
    await wait(100);
  }
  throw new Error("Playwright server wrapper did not become ready");
}

test("Playwright-style SIGTERM delegates cleanup instead of orphaning the local tree", { timeout: 30_000 }, async () => {
  const beforeNextEnv = await readFile("next-env.d.ts", "utf8");
  const wrapper = spawn(process.execPath, ["scripts/playwright-local-server.mjs"], {
    cwd: process.cwd(), env: { ...process.env, INF_LOCAL_SKIP_API_BUILD: "true" }, stdio: "ignore",
  });
  try {
    await ready();
    const exited = new Promise((resolveExit) => wrapper.once("exit", resolveExit));
    wrapper.kill("SIGTERM");
    const code = await Promise.race([
      exited,
      wait(12_000).then(() => { throw new Error("Playwright wrapper did not finish bounded cleanup"); }),
    ]);
    assert.equal(code, 0);
    for (const port of ports) {
      await assert.rejects(execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]));
    }
    await assert.rejects(access(".codex/run/inf-local.json"));
    await assert.rejects(access(".codex/run/staticwebapp.local.json"));
    assert.equal(await readFile("next-env.d.ts", "utf8"), beforeNextEnv);
  } finally {
    try { wrapper.kill("SIGKILL"); } catch { /* already stopped */ }
  }
});
