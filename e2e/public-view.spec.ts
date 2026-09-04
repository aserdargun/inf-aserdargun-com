import { expect, test } from "playwright/test";
import { readFileSync } from "node:fs";
import { expectFocusAboveBottomNavigation, expectViewportAccessibility } from "./support/accessibility";

const item = {
  id: "00000000-0000-4000-8000-000000000101",
  title: "GPU memory hierarchy",
  publishedAt: "2024-05-12T00:00:00.000Z",
  thumbnailUrl: "/api/public/images/thumbnail-101",
  imageUrl: "/api/public/images/original-101",
};
const image = readFileSync("api/test/fixtures/valid-infographic.png");

function publicPage(items: typeof item[] | [], overrides: { page?: number; pageSize?: number; totalItems?: number; totalPages?: number } = {}) {
  const page = overrides.page ?? 1;
  const pageSize = overrides.pageSize ?? 12;
  const totalItems = overrides.totalItems ?? items.length;
  const totalPages = overrides.totalPages ?? (items.length === 0 ? 0 : Math.ceil(items.length / pageSize));
  return { items, page, pageSize, totalItems, totalPages };
}

async function mockPublic(page: import("playwright/test").Page, mode: "success" | "empty" | "error" | "paginated" = "success") {
  // A function matcher reliably handles the trailing query string that
  // accompanies `?page=2` requests; the previous `**/...` glob dropped those
  // because Playwright's URL glob stops at the `?` query delimiter.
  await page.route((url) => url.pathname === "/api/public/infographics" || /^\/api\/public\/infographics\/[0-9a-f-]+$/i.test(url.pathname), (route) => {
    const url = new URL(route.request().url());
    if (mode === "error") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    if (url.pathname.endsWith(item.id)) return route.fulfill({ status: mode === "empty" ? 404 : 200, contentType: "application/json", body: JSON.stringify(item) });
    if (mode === "empty") return route.fulfill({ contentType: "application/json", body: JSON.stringify(publicPage([])) });
    if (mode === "paginated") {
      const requestedPage = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
      const first = { ...item, id: "00000000-0000-4000-8000-000000000101", title: "Page 1 item", publishedAt: "2024-05-12T00:00:00.000Z" };
      const second = { ...item, id: "00000000-0000-4000-8000-000000000102", title: "Page 2 item", publishedAt: "2024-05-11T00:00:00.000Z" };
      const third = { ...item, id: "00000000-0000-4000-8000-000000000103", title: "Page 2 item second", publishedAt: "2024-05-10T00:00:00.000Z" };
      // The pager is shown only when totalPages > 1. The test expects exactly two
      // pages and a "2 infographics" status, so pin both numbers explicitly.
      if (requestedPage <= 1) return route.fulfill({ contentType: "application/json", body: JSON.stringify(publicPage([first], { page: 1, pageSize: 1, totalItems: 2, totalPages: 2 })) });
      if (requestedPage === 2) return route.fulfill({ contentType: "application/json", body: JSON.stringify(publicPage([third], { page: 2, pageSize: 1, totalItems: 2, totalPages: 2 })) });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(publicPage([], { page: requestedPage, pageSize: 1, totalItems: 2, totalPages: 2 })) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(publicPage([item])) });
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

test("uses bounded public states and media canvases without exposing owner data", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "serviceWorker", { configurable: true, value: undefined });
  });
  await mockPublic(page, "empty");
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/view/");

  const state = page.locator(".public-state");
  await expect(state).toHaveCSS("max-width", "680px");
  await expect(state).toHaveCSS("min-height", "0px");

  await page.unrouteAll();
  await mockPublic(page);
  await page.reload();
  await expect(page.locator(".public-grid .media-canvas--gallery")).toHaveCount(1);

  await page.goto(`/view/${item.id}/`);
  await expect(page.locator(".public-detail .media-canvas--detail")).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText(/Source URL|Platform|Category|Tags|favorite|review history|archive|settings/i);
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

test("replaces a failed public thumbnail with an explicit fallback", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "serviceWorker", { configurable: true, value: undefined });
  });
  await mockPublic(page);
  await page.unroute("**/api/public/images/**");
  let imageRequests = 0;
  await page.route("**/api/public/images/**", (route) => {
    imageRequests += 1;
    return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });
  await page.goto("/view/");
  await expect(page.getByRole("img", { name: `${item.title} preview unavailable` })).toHaveText("Preview unavailable");
  expect(imageRequests).toBe(2);
});

test("public View Mode is responsive, keyboard reachable, and console-clean", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await mockPublic(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/view/");
  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await expectViewportAccessibility(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFocusAboveBottomNavigation(page, page.getByRole("link", { name: "Admin sign in" }));
  await page.getByRole("link", { name: "Open GPU memory hierarchy" }).focus();
  await expect(page.getByRole("link", { name: "Open GPU memory hierarchy" })).toBeFocused();
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBeTruthy();
  await page.screenshot({ fullPage: true, path: ".superpowers/sdd/2026-08-20-inf-mvp-implementation/task-13-public-mobile.png" });
  expect(errors).toEqual([]);
});

test("public gallery paginates with stable URLs, deep links, and an accessible status", async ({ page }) => {
  // The /view/ service worker intercepts /api/public/infographics and bypasses
  // the page.route mock for the second request, so disable it for this test.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "serviceWorker", { configurable: true, value: undefined });
  });
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await mockPublic(page, "paginated");
  await page.goto("/view/");
  await expect(page.getByRole("link", { name: "Open Page 1 item" })).toBeVisible();
  await expect(page.locator(".public-pager__status")).toContainText("Page 1 of 2");
  await expect(page.locator(".public-pager__status")).toContainText("2 infographics");
  await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/\/view\/\?page=2$/);
  await expect(page.getByRole("link", { name: "Open Page 2 item second" })).toBeVisible();
  await expect(page.locator(".public-pager__status")).toContainText("Page 2 of 2");
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(page).toHaveURL(/\/view\/$/);
  await expect(page.getByRole("link", { name: "Open Page 1 item" })).toBeVisible();
  await page.goto("/view/?page=2");
  await expect(page.getByRole("link", { name: "Open Page 2 item second" })).toBeVisible();
  await expect(page.locator(".public-pager__status")).toContainText("Page 2 of 2");
  expect(errors).toEqual([]);
});

test("home page opens the public gallery and never asks for sign-in", async ({ page }) => {
  await page.route("**/api/public/infographics", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(publicPage([item])) }));
  await page.route("**/api/public/images/**", (route) => route.fulfill({ body: image, contentType: "image/png" }));
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Infographics" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open GPU memory hierarchy" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  await expect(page.locator(".public-view__admin-link")).toHaveAttribute("href", "/login/");
});
