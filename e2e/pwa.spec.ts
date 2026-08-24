import { expect, test } from "playwright/test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const image = readFileSync("api/test/fixtures/valid-infographic.png");

test("Chromium keeps data and nomodule scripts inert while executing supported script types", async ({ page }) => {
  await page.setContent([
    "<!doctype html>",
    '<script type="application/json">globalThis.__jsonRan=true</script>',
    '<script type="text/plain">globalThis.__plainRan=true</script>',
    "<script nomodule>globalThis.__nomoduleRan=true</script>",
    "<script>globalThis.__classicRan=true</script>",
    '<script type="text/javascript">globalThis.__exactMimeRan=true</script>',
    '<script type=" \ttext/javascript\r\n ">globalThis.__asciiWhitespaceMimeRan=true</script>',
    '<script type="text/javascript; charset=utf-8">globalThis.__parameterizedMimeRan=true</script>',
    '<script type="\u00a0text/javascript\u00a0">globalThis.__nbspMimeRan=true</script>',
    '<script type="\ufefftext/javascript\ufeff">globalThis.__bomMimeRan=true</script>',
    '<script type="module">globalThis.__moduleRan=true</script>',
  ].join(""));
  await expect.poll(() => page.evaluate(() => ({
    asciiWhitespaceMime: (globalThis as typeof globalThis & { __asciiWhitespaceMimeRan?: boolean }).__asciiWhitespaceMimeRan,
    classic: (globalThis as typeof globalThis & { __classicRan?: boolean }).__classicRan,
    bomMime: (globalThis as typeof globalThis & { __bomMimeRan?: boolean }).__bomMimeRan,
    exactMime: (globalThis as typeof globalThis & { __exactMimeRan?: boolean }).__exactMimeRan,
    json: (globalThis as typeof globalThis & { __jsonRan?: boolean }).__jsonRan,
    module: (globalThis as typeof globalThis & { __moduleRan?: boolean }).__moduleRan,
    nomodule: (globalThis as typeof globalThis & { __nomoduleRan?: boolean }).__nomoduleRan,
    nbspMime: (globalThis as typeof globalThis & { __nbspMimeRan?: boolean }).__nbspMimeRan,
    parameterizedMime: (globalThis as typeof globalThis & { __parameterizedMimeRan?: boolean }).__parameterizedMimeRan,
    plain: (globalThis as typeof globalThis & { __plainRan?: boolean }).__plainRan,
  }))).toEqual({ asciiWhitespaceMime: true, bomMime: undefined, classic: true, exactMime: true, json: undefined, module: true, nbspMime: undefined, nomodule: undefined, parameterizedMime: undefined, plain: undefined });
});

test("production-static routes enforce functional CSP and intentional cache headers", async ({ page, request }) => {
  const violations: string[] = [];
  page.on("console", (message) => { if (/content security policy|refused to (?:execute|load|apply)/i.test(message.text())) violations.push(message.text()); });
  page.on("pageerror", (error) => { if (/content security policy/i.test(error.message)) violations.push(error.message); });
  const viewHtml = readFileSync("out/view/index.html", "utf8");
  const immutablePath = viewHtml.match(/\/(?:_next\/static\/[^"']+)/)?.[0];
  expect(immutablePath).toBeTruthy();
  const expected = [
    ["/", "private, no-store"],
    ["/view/", "public, max-age=0, must-revalidate"],
    ["/manifest.webmanifest", "public, max-age=300, must-revalidate"],
    ["/view/sw.js", "public, max-age=0, must-revalidate"],
    [immutablePath!, "public, max-age=31536000, immutable"],
  ];
  let csp = "";
  for (const [path, cache] of expected) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["cache-control"], path).toBe(cache);
    expect(response.headers()["referrer-policy"], path).toBe("no-referrer");
    expect(response.headers()["x-content-type-options"], path).toBe("nosniff");
    expect(response.headers()["x-frame-options"], path).toBe("DENY");
    csp ||= response.headers()["content-security-policy"] ?? "";
    expect(response.headers()["content-security-policy"], path).toBe(csp);
  }
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toMatch(/script-src 'self' 'sha256-/);
  expect(csp).not.toMatch(/script-src[^;]*(?:unsafe-inline|unsafe-eval|\*|https?:)/);
  await page.route("**/api/public/infographics", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("/view/");
  await expect(page.getByRole("heading", { name: "Infographics" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  expect(violations).toEqual([]);
});

test("browser-parsed inline script bodies exactly match the authoritative CSP hashes", async ({ page }) => {
  await page.goto("/");
  const htmlFiles = (readdirSync("out", { recursive: true }) as string[])
    .filter((path) => path.endsWith(".html"))
    .sort()
    .map((path) => ({ html: readFileSync(`out/${path}`, "utf8"), path }));
  const bodies = await page.evaluate((files) => files.flatMap(({ html, path }) => {
    const document = new DOMParser().parseFromString(html, "text/html");
    return [...document.scripts]
      .filter((script) => !script.hasAttribute("src") && script.textContent?.trim())
      .map((script) => ({ body: script.textContent ?? "", path }));
  }), htmlFiles);
  expect(bodies.length).toBeGreaterThan(0);
  const browserHashes = [...new Set(bodies.map(({ body }) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`))].sort();
  const config = JSON.parse(readFileSync("out/staticwebapp.config.json", "utf8"));
  const policyHashes = [...config.globalHeaders["Content-Security-Policy"].matchAll(/'sha256-[^']+'/g)].map((match: RegExpMatchArray) => match[0]).sort();
  expect(browserHashes).toEqual(policyHashes);
});

test("View Mode exposes a local manifest, icons, and non-blocking service-worker registration", async ({ page, request }) => {
  const external: string[] = [];
  page.on("request", (entry) => { if (new URL(entry.url()).origin !== "http://127.0.0.1:4280") external.push(entry.url()); });
  await page.route("**/api/public/infographics", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("/view/");
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.length).toBeGreaterThan(0);
  const pngIcons = manifest.icons.filter((icon: { type?: string }) => icon.type === "image/png");
  expect(pngIcons.length).toBeGreaterThanOrEqual(3);
  for (const icon of pngIcons) {
    const response = await request.get(icon.src);
    expect(response.headers()["content-type"]).toContain("image/png");
    expect((await response.body()).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  const workerResponse = await request.get("/view/sw.js");
  expect(workerResponse.headers()["content-type"]).toContain("javascript");
  expect(await workerResponse.text()).toContain("self.addEventListener");
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker?.getRegistration("/view/").then((value) => value?.scope) ?? "")).toBe("http://127.0.0.1:4280/view/");
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller))).toBeFalsy();
  expect(external).toEqual([]);
});

test("deployed worker replaces a stale release, refreshes View navigation, and falls back offline", async ({ page, context }) => {
  await page.goto("/login/");
  await page.evaluate(async () => {
    const old = await caches.open("PUBLIC-CACHE-v1-static");
    await old.put("/view/", new Response("<h1>stale release</h1>", { headers: { "Content-Type": "text/html" } }));
  });
  await page.route("**/api/public/infographics", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("/view/");
  await expect(page.getByRole("heading", { name: "Infographics" })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => ({
    controlled: Boolean(navigator.serviceWorker?.controller),
    names: await caches.keys(),
  }))).toMatchObject({ controlled: true, names: expect.not.arrayContaining(["PUBLIC-CACHE-v1-static"]) });
  const current = await page.evaluate(async () => (await caches.keys()).find((name) => /^INF-PUBLIC-[a-f0-9]{64}-static$/.test(name)) ?? "");
  expect(current).toMatch(/^INF-PUBLIC-[a-f0-9]{64}-static$/);
  await page.evaluate(async (cacheName) => {
    const cache = await caches.open(cacheName);
    await cache.put("/view/", new Response("<h1>stale release</h1>", { headers: { "Content-Type": "text/html" } }));
  }, current);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Infographics" })).toBeVisible();
  const refreshed = await page.evaluate(async (cacheName) => (await (await caches.open(cacheName)).match("/view/"))?.text(), current);
  expect(refreshed).toContain('class="public-view"');
  expect(refreshed).toContain("inf-static-release");
  expect(refreshed).not.toContain("stale release");
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole("heading", { name: "Infographics" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("loading, empty, error, and sparse success public states keep the footer at the viewport edge", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "serviceWorker", { configurable: true, value: undefined }));
  const item = { id: "00000000-0000-4000-8000-000000000301", title: "One public item", publishedAt: "2024-05-12T00:00:00.000Z", thumbnailUrl: "/api/public/images/thumb-301", imageUrl: "/api/public/images/original-301" };
  const states = [
    { name: "loading", text: "Loading infographics…", respond: () => new Promise<void>(() => undefined) },
    { name: "empty", text: "No infographics are available.", respond: (route: import("playwright/test").Route) => route.fulfill({ contentType: "application/json", body: "[]" }) },
    { name: "error", text: "This collection is unavailable right now.", respond: (route: import("playwright/test").Route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) },
    { name: "success", text: "One public item", respond: (route: import("playwright/test").Route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([item]) }) },
  ] as const;
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) for (const state of states) {
    await page.unrouteAll(); await page.route("**/api/public/infographics", state.respond); await page.route("**/api/public/images/**", (route) => route.fulfill({ contentType: "image/png", body: image })); await page.setViewportSize(viewport); await page.goto(`/view/?state=${state.name}`);
    await expect(page.getByText(state.text, { exact: true })).toBeVisible();
    await expect.poll(() => page.locator(".public-view__footer").evaluate((element) => Math.round(element.getBoundingClientRect().bottom))).toBe(viewport.height);
    if (state.name === "success") await page.screenshot({ fullPage: true, path: `.superpowers/sdd/2026-08-20-inf-mvp-implementation/task-13-round2-footer-${viewport.width}.png` });
  }
});

test("service worker policy does not cache private, mutation, error, or cross-origin requests", async () => {
  const worker = readFileSync("public/view/sw.js", "utf8");
  expect(worker).toContain("request.method !== \"GET\"");
  expect(worker).toContain("url.origin !== self.location.origin");
  expect(worker).toContain("response.ok");
  expect(worker).toContain("writeBestEffort(DATA_CACHE, request, response)");
});
