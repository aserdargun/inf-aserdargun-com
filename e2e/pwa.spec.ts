import { expect, test } from "playwright/test";
import { readFileSync } from "node:fs";

test("View Mode exposes a local manifest, icons, and non-blocking service-worker registration", async ({ page, request }) => {
  const external: string[] = [];
  page.on("request", (entry) => { if (new URL(entry.url()).origin !== "http://127.0.0.1:3000") external.push(entry.url()); });
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
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker?.getRegistration().then((value) => Boolean(value)) ?? false)).toBeTruthy();
  expect(external).toEqual([]);
});

test("service worker policy does not cache private, mutation, error, or cross-origin requests", async () => {
  const worker = readFileSync("public/sw.js", "utf8");
  expect(worker).toContain("request.method !== \"GET\"");
  expect(worker).toContain("url.origin !== self.location.origin");
  expect(worker).toContain("response.ok");
  expect(worker).toContain("writeBounded(DATA_CACHE, request, response)");
});
