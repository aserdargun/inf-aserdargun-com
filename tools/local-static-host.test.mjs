import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("production preview serves only the built static artifact with route and MIME fallbacks", { timeout: 10_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "inf-static-host-"));
  await mkdir(join(root, "view")); await writeFile(join(root, "index.html"), "<h1>owner artifact</h1>"); await writeFile(join(root, "view", "index.html"), "<h1>public artifact</h1>"); await writeFile(join(root, "asset.png"), Buffer.from([137, 80, 78, 71]));
  const child = spawn(process.execPath, ["scripts/local-static-host.mjs"], { cwd: process.cwd(), env: { ...process.env, INF_LOCAL_STATIC_ROOT: root, INF_LOCAL_WEB_PORT: "4399" }, stdio: "ignore" });
  try {
    let response;
    for (let i = 0; i < 50; i += 1) { response = await fetch("http://127.0.0.1:4399/view").catch(() => undefined); if (response) break; await new Promise((resolve) => globalThis.setTimeout(resolve, 50)); }
    assert.equal(response?.status, 200); assert.equal(await response.text(), "<h1>public artifact</h1>");
    const image = await fetch("http://127.0.0.1:4399/asset.png"); assert.equal(image.headers.get("content-type"), "image/png"); assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from([137, 80, 78, 71]));
    assert.equal((await fetch("http://127.0.0.1:4399/../package.json")).status, 404);
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await new Promise((resolve) => child.once("exit", resolve)); } await rm(root, { recursive: true, force: true }); }
});
