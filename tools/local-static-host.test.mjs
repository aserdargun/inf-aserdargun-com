import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("production preview serves only the built static artifact with route and MIME fallbacks", { timeout: 10_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "inf-static-host-"));
  const csp = "default-src 'self'; frame-ancestors 'none'; script-src 'self'";
  await mkdir(join(root, "view"), { recursive: true });
  await mkdir(join(root, "infographic"), { recursive: true });
  await mkdir(join(root, "_next/static/chunks"), { recursive: true });
  await mkdir(join(root, "icons"), { recursive: true });
  await writeFile(join(root, "index.html"), "<h1>owner artifact</h1>");
  await writeFile(join(root, "view", "index.html"), "<h1>public artifact</h1>");
  await writeFile(join(root, "infographic", "index.html"), "<h1>owner detail artifact</h1>");
  await writeFile(join(root, "view", "sw.js"), "self.addEventListener('fetch',()=>{});");
  await writeFile(join(root, "manifest.webmanifest"), "{}");
  await writeFile(join(root, "icons", "icon-192.png"), Buffer.from([137, 80, 78, 71]));
  await writeFile(join(root, "_next/static/chunks/app.12345678.js"), "globalThis.__app=true;");
  await writeFile(join(root, "asset.png"), Buffer.from([137, 80, 78, 71]));
  await writeFile(join(root, "staticwebapp.config.json"), JSON.stringify({
    globalHeaders: {
      "Content-Security-Policy": csp,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Cache-Control": "private, no-store",
    },
    routes: [
      { route: "/view/sw.js", headers: { "Cache-Control": "public, max-age=0, must-revalidate" } },
      { route: "/view/*", rewrite: "/view/index.html", headers: { "Cache-Control": "public, max-age=0, must-revalidate" } },
      { route: "/view*", rewrite: "/view/index.html", headers: { "Cache-Control": "public, max-age=0, must-revalidate" } },
      { route: "/infographic/*", rewrite: "/infographic/index.html" },
      { route: "/manifest.webmanifest", headers: { "Cache-Control": "public, max-age=300, must-revalidate" } },
      { route: "/icons/*", headers: { "Cache-Control": "public, max-age=86400, must-revalidate" } },
      { route: "/_next/static/*", headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
    ],
  }));
  const child = spawn(process.execPath, ["scripts/local-static-host.mjs"], { cwd: process.cwd(), env: { ...process.env, INF_LOCAL_STATIC_ROOT: root, INF_LOCAL_WEB_PORT: "4399" }, stdio: "ignore" });
  try {
    let response;
    for (let i = 0; i < 50; i += 1) { response = await fetch("http://127.0.0.1:4399/view").catch(() => undefined); if (response) break; await new Promise((resolve) => globalThis.setTimeout(resolve, 50)); }
    assert.equal(response?.status, 200); assert.equal(await response.text(), "<h1>public artifact</h1>");
    const expected = [
      ["/", "private, no-store"],
      ["/view/", "public, max-age=0, must-revalidate"],
      ["/manifest.webmanifest", "public, max-age=300, must-revalidate"],
      ["/view/sw.js", "public, max-age=0, must-revalidate"],
      ["/_next/static/chunks/app.12345678.js", "public, max-age=31536000, immutable"],
      ["/icons/icon-192.png", "public, max-age=86400, must-revalidate"],
    ];
    for (const [path, cache] of expected) {
      const secured = await fetch(`http://127.0.0.1:4399${path}`);
      assert.equal(secured.status, 200, path);
      assert.equal(secured.headers.get("content-security-policy"), csp, path);
      assert.equal(secured.headers.get("referrer-policy"), "no-referrer", path);
      assert.equal(secured.headers.get("x-content-type-options"), "nosniff", path);
      assert.equal(secured.headers.get("x-frame-options"), "DENY", path);
      assert.equal(secured.headers.get("cache-control"), cache, path);
    }
    const publicDetail = await fetch("http://127.0.0.1:4399/view/00000000-0000-4000-8000-000000000001/");
    assert.equal(publicDetail.status, 200);
    assert.equal(await publicDetail.text(), "<h1>public artifact</h1>");
    assert.equal(publicDetail.headers.get("cache-control"), "public, max-age=0, must-revalidate");
    const ownerDetail = await fetch("http://127.0.0.1:4399/infographic/00000000-0000-4000-8000-000000000001/");
    assert.equal(ownerDetail.status, 200);
    assert.equal(await ownerDetail.text(), "<h1>owner detail artifact</h1>");
    assert.equal(ownerDetail.headers.get("cache-control"), "private, no-store");
    const image = await fetch("http://127.0.0.1:4399/asset.png"); assert.equal(image.headers.get("content-type"), "image/png"); assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from([137, 80, 78, 71]));
    assert.equal((await fetch("http://127.0.0.1:4399/../package.json")).status, 404);
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await new Promise((resolve) => child.once("exit", resolve)); } await rm(root, { recursive: true, force: true }); }
});
