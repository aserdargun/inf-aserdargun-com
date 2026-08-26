import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
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

async function allListenersReady() {
  for (const port of ports) {
    try {
      const { stdout } = await execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
      if (!stdout.trim()) return false;
    } catch (error) {
      if (error.code === 1) return false;
      throw error;
    }
  }
  return true;
}

async function chunkedOverLimit(port) {
  return new Promise((resolveResult, rejectResult) => {
    let responseStarted = false;
    const request = httpRequest({ host: "127.0.0.1", port, method: "POST", path: "/api/infographics", headers: { "content-type": "application/octet-stream", "transfer-encoding": "chunked" } }, (response) => {
      responseStarted = true; response.resume(); response.once("end", () => resolveResult(response.statusCode));
    });
    request.on("error", (error) => { if (!responseStarted) rejectResult(error); });
    request.write(Buffer.alloc((21 * 1024 * 1024) + 1));
    request.end();
  });
}

async function declaredOverLimit(port) {
  return new Promise((resolveResult, rejectResult) => {
    const request = httpRequest({ host: "127.0.0.1", port, method: "POST", path: "/api/infographics", headers: { "content-type": "application/octet-stream", "content-length": String((20 * 1024 * 1024) + 1) } }, (response) => {
      response.resume(); response.once("end", () => resolveResult(response.statusCode));
    });
    request.on("error", rejectResult); request.end(Buffer.alloc((20 * 1024 * 1024) + 1));
  });
}

function assertSecurity(response, cache) {
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.match(response.headers.get("cache-control") ?? "", cache);
}


test("real 4280 to 7072 to 7071 chain covers every compiled API family and Stop reaps the loopback tree", { timeout: 120_000 }, async () => {
  await run(process.execPath, ["scripts/stop-local.mjs"]);
  await rm(".codex/run/storage", { recursive: true, force: true });
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
    assertSecurity(publicCatalog, /public/);
    const ownerCatalog = await fetch("http://127.0.0.1:4280/api/infographics");
    assert.equal(ownerCatalog.status, 200);
    assertSecurity(ownerCatalog, /no-store/);

    const png = await readFile("api/test/fixtures/valid-infographic.png");
    const form = new globalThis.FormData();
    form.set("title", "Compiled route matrix"); form.set("notes", "private route note");
    form.set("file", new globalThis.File([png], "matrix.png", { type: "image/png" }));
    const capture = await fetch("http://127.0.0.1:4280/api/infographics", { method: "POST", body: form });
    const captureText = await capture.text(); assert.equal(capture.status, 201, captureText); assertSecurity(capture, /no-store/);
    const captured = JSON.parse(captureText); const id = captured.infographicId;
    assert.match(id, /^[0-9a-f-]{36}$/); assert.equal(captured.title, "Compiled route matrix");

    const invalidQuery = await fetch("http://127.0.0.1:4280/api/infographics?favorite=maybe"); assert.equal(invalidQuery.status, 400);
    const detail = await fetch(`http://127.0.0.1:4280/api/infographics/${id}`); assert.equal(detail.status, 200);
    const item = await detail.json(); assert.equal(item.notes, "private route note");

    const publicListResponse = await fetch("http://127.0.0.1:4280/api/public/infographics");
    assert.equal(publicListResponse.status, 200); assertSecurity(publicListResponse, /public/);
    const publicPage = await publicListResponse.json(); assert.equal(publicPage.page, 1); assert.equal(publicPage.pageSize, 12);
    const projected = publicPage.items.find((entry) => entry.id === id);
    assert.ok(projected); assert.equal("notes" in projected, false);
    const publicDetail = await fetch(`http://127.0.0.1:4280/api/public/infographics/${id}`); assert.equal(publicDetail.status, 200); assertSecurity(publicDetail, /public/);
    for (const [fileId, mime] of [[item.originalDriveFileId, "image/png"], [item.thumbnailDriveFileId, "image/webp"]]) {
      const image = await fetch(`http://127.0.0.1:4280/api/public/images/${fileId}`);
      assert.equal(image.status, 200); assert.equal(image.headers.get("content-type"), mime); assertSecurity(image, /immutable/); assert.ok((await image.arrayBuffer()).byteLength > 20);
    }

    const category = { id: "11111111-1111-4111-8111-111111111111", displayName: "Systems", normalizedName: "systems", slug: "systems" };
    const tag = { id: "22222222-2222-4222-8222-222222222222", displayName: "Routes", normalizedName: "routes", slug: "routes" };
    const patched = await fetch(`http://127.0.0.1:4280/api/infographics/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Compiled matrix updated", favorite: true, categories: [category], tags: [tag] }) });
    assert.equal(patched.status, 200); assert.deepEqual(await patched.json(), { updated: true });
    const queried = await fetch("http://127.0.0.1:4280/api/infographics?q=compiled&category=systems&tag=routes&favorite=true&sort=recent");
    assert.equal(queried.status, 200); assert.equal((await queried.json()).infographics[0].id, id);
    assert.equal((await fetch(`http://127.0.0.1:4280/api/infographics/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" })).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:4280/api/infographics/not-a-uuid`)).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:4280/api/infographics/${id}/seen`, { method: "POST" })).status, 204);
    const review = await fetch(`http://127.0.0.1:4280/api/infographics/${id}/reviews`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating: "good" }) });
    assert.equal(review.status, 200); assert.equal((await review.json()).rating, "good");
    assert.equal((await fetch(`http://127.0.0.1:4280/api/infographics/${id}/reviews`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating: "invalid" }) })).status, 400);
    const surprise = await fetch("http://127.0.0.1:4280/api/surprise"); assert.equal(surprise.status, 200); assert.equal((await surprise.json()).infographic.id, id);
    const due = await fetch("http://127.0.0.1:4280/api/review"); assert.equal(due.status, 200); assert.ok(Array.isArray((await due.json()).infographics));
    const stats = await fetch("http://127.0.0.1:4280/api/settings/stats"); assert.equal(stats.status, 200); assert.equal((await stats.json()).total, 1);
    const health = await fetch("http://127.0.0.1:4280/api/settings/health"); assert.equal(health.status, 200); assert.equal((await health.json()).recovery.items[0].id, id);
    const sync = await fetch("http://127.0.0.1:4280/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 1 }) }); assert.equal(sync.status, 200); assert.equal(typeof (await sync.json()), "object");
    assert.equal((await fetch("http://127.0.0.1:4280/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: "{}x" })).status, 400);
    assert.equal((await fetch("http://127.0.0.1:4280/api/infographics", { method: "PUT" })).status, 404);
    assert.equal((await fetch("http://127.0.0.1:4280/api/unknown-route")).status, 404);

    for (const port of [7071, 7072, 4280]) {
      assert.equal(await declaredOverLimit(port), 413, `declared over-limit through ${port}`);
      assert.equal(await chunkedOverLimit(port), 413, `chunked over-limit through ${port}`);
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/public/infographics`)).status, 200, `health after 413 through ${port}`);
    }
    const deleted = await fetch(`http://127.0.0.1:4280/api/infographics/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) });
    assert.equal(deleted.status, 204); assert.equal((await fetch(`http://127.0.0.1:4280/api/infographics/${id}`)).status, 404);
    assert.equal((await fetch("http://127.0.0.1:4280/api/session")).status, 200);
    await waitFor(allListenersReady, "all four loopback listeners");
    for (const port of ports) {
      const { stdout } = await execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-F", "n"]);
      assert.match(stdout, /n127\.0\.0\.1:/, `port ${port} must be loopback-only`);
      assert.doesNotMatch(stdout, /n\*:/, `port ${port} must not be wildcard-bound`);
    }
  } finally {
    const stopped = await run(process.execPath, ["scripts/stop-local.mjs"]);
    assert.equal(stopped.code, 0, stopped.output);
    await rm(".codex/run/storage", { recursive: true, force: true });
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
