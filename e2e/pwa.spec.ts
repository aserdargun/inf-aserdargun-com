import { expect, test } from "playwright/test";
import { readFileSync } from "node:fs";

const image = readFileSync("api/test/fixtures/valid-infographic.png");

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

test("View Mode exposes a local manifest, icons, and non-blocking service-worker registration", async ({ page, request }) => {
  const external: string[] = [];
  page.on("request", (entry) => { if (new URL(entry.url()).origin !== "http://127.0.0.1:4280") external.push(entry.url()); });
  await page.route("**/api/public/infographics", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("/view/");
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons).toHaveLength(3);
  for (const icon of manifest.icons) {
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
  expect(worker).toContain("writeBounded(DATA_CACHE, request, response)");
});
