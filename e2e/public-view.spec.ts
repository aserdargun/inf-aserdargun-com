import { expect, test } from "playwright/test";
import { readFileSync } from "node:fs";

const item = {
  id: "00000000-0000-4000-8000-000000000101",
  title: "GPU memory hierarchy",
  publishedAt: "2024-05-12T00:00:00.000Z",
  thumbnailUrl: "/api/public/images/thumbnail-101",
  imageUrl: "/api/public/images/original-101",
};
const image = readFileSync("api/test/fixtures/valid-infographic.png");

async function mockPublic(page: import("playwright/test").Page, mode: "success" | "empty" | "error" = "success") {
  await page.route("**/api/public/infographics**", (route) => {
    const url = new URL(route.request().url());
    if (mode === "error") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    if (url.pathname.endsWith(item.id)) return route.fulfill({ status: mode === "empty" ? 404 : 200, contentType: "application/json", body: JSON.stringify(item) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(mode === "empty" ? [] : [item]) });
  });
  await page.route("**/api/public/images/**", (route) => route.fulfill({ body: image, contentType: "image/png" }));
}

test("anonymous View Mode uses only public DTO fields and APIs", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/")) requests.push(new URL(request.url()).pathname); });
  await mockPublic(page);
  await page.goto("/view/");
  await expect(page.getByRole("heading", { name: "Infographics" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open GPU memory hierarchy" })).toBeVisible();
  await expect(page.getByText("May 12, 2024", { exact: true })).toBeVisible();
  await expect(page.locator(".public-view-only")).toHaveText("View only");
  expect(requests.every((path) => path.startsWith("/api/public/"))).toBeTruthy();
  await expect(page.locator("body")).not.toContainText(/Source URL|Platform|Category|Tags|favorite|review history|archive|settings/i);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add to favorites|Archive|Delete|Save changes|Settings/ })).toHaveCount(0);
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBeTruthy();
  await page.screenshot({ fullPage: true, path: ".superpowers/sdd/2026-08-20-inf-mvp-implementation/task-13-public-desktop.png" });
});

test("public gallery and static-path detail expose safe loading, empty, error and not-found states", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "serviceWorker", { configurable: true, value: undefined });
  });
  await page.route("**/api/public/infographics**", () => new Promise(() => undefined));
  await page.goto("/view/");
  await expect(page.getByText("Loading infographics…", { exact: true })).toBeVisible();
  await page.unrouteAll();
  await mockPublic(page, "empty");
  await page.reload();
  await expect(page.getByText("No infographics are available.")).toBeVisible();
  await page.unrouteAll();
  await mockPublic(page, "error");
  await page.reload();
  await expect(page.getByText("This collection is unavailable right now.")).toBeVisible();
  await page.unrouteAll();
  await mockPublic(page);
  await page.goto(`/view/${item.id}/`);
  await expect(page.getByRole("heading", { name: item.title })).toBeVisible();
  await expect(page.getByRole("img", { name: item.title })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Infographics" })).toBeVisible();
  await page.goto("/view/not-a-uuid/");
  await expect(page.getByText("This infographic is not available.")).toBeVisible();
});

test("public View Mode is responsive, keyboard reachable, and console-clean", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await mockPublic(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/view/");
  await page.getByRole("link", { name: "Open GPU memory hierarchy" }).focus();
  await expect(page.getByRole("link", { name: "Open GPU memory hierarchy" })).toBeFocused();
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBeTruthy();
  await page.screenshot({ fullPage: true, path: ".superpowers/sdd/2026-08-20-inf-mvp-implementation/task-13-public-mobile.png" });
  expect(errors).toEqual([]);
});
