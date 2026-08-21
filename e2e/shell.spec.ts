import { expect, test } from "playwright/test";

const item = {
  id: "00000000-0000-4000-8000-000000000001", title: "GPU memory hierarchy", notes: null, sourceUrl: null, sourcePlatform: null, sourceAuthor: null,
  originalDriveFileId: "original", thumbnailDriveFileId: "thumbnail", sha256: "a".repeat(64), detectedMimeType: "image/png", width: 1200, height: 900,
  favorite: false, archived: false, createdAt: "2026-08-20T10:00:00.000Z", capturedAt: "2026-08-20T10:00:00.000Z", processedAt: null, lastSeenAt: null,
  seenCount: 0, categoryIds: [], tagIds: [], folderState: "Inbox", reviewCount: 0, lastReviewedAt: null, reviewDueAt: "2026-08-21T10:00:00.000Z",
};

async function mockToday(page: import("playwright/test").Page, mode: "success" | "empty" | "error") {
  await page.route("**/api/infographics", async (route) => {
    if (mode === "error") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: mode === "empty" ? [] : [item], categories: [], tags: [] }) });
  });
  await page.route("**/api/settings/stats", async (route) => {
    if (mode === "error") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ total: mode === "empty" ? 0 : 1, inbox: 1, library: 0, archive: 0, due: 1, reviewed: 0, seen: 0 }) });
  });
}

test("owner sees Today navigation and primary learning actions", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Library" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Review", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Surprise me" })).toBeVisible();
});

test("switches navigation atomically at the approved breakpoint and keeps Settings reachable", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".mobile-nav")).toBeHidden();

  await page.setViewportSize({ width: 767, height: 900 });
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator(".mobile-nav")).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(page.locator(".mobile-nav").getByRole("link")).toHaveCount(5);
});

test("persists an accessible keyboard theme choice", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Switch to dark theme" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("inf-theme"))).toBe("dark");
});

test("shows loading, empty, error, and success Today states with exact copy", async ({ page }) => {
  await page.route("**/api/infographics", () => new Promise(() => undefined));
  await page.route("**/api/settings/stats", () => new Promise(() => undefined));
  await page.goto("/");
  await expect(page.getByText("Loading Today…", { exact: true })).toBeVisible();
  await page.unrouteAll();

  await mockToday(page, "empty");
  await page.reload();
  await expect(page.getByText("Nothing needs your attention right now.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add infographic" })).toBeVisible();
  await page.unrouteAll();

  await mockToday(page, "error");
  await page.reload();
  await expect(page.getByText("Today could not be loaded. Try again.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.unrouteAll();

  await mockToday(page, "success");
  await page.reload();
  await expect(page.getByText("Inbox 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Library 0", { exact: true })).toBeVisible();
  await expect(page.getByText("Due today 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recently added" })).toBeVisible();
  await expect(page.getByRole("img", { name: "GPU memory hierarchy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review next" })).toBeVisible();
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBeTruthy();
});

test("login and public view keep their approved access boundaries", async ({ page }) => {
  await page.goto("/login/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
  await page.goto("/view/");
  await expect(page.getByRole("heading", { name: "Infographics" })).toBeVisible();
  await expect(page.getByText("A public collection of visual notes.", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
});

test("login exposes the GitHub failure recovery copy", async ({ page }) => {
  await page.goto("/login/?error=github");
  await expect(page.getByText("We could not sign you in. Try again.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("login reports a pending GitHub sign-in immediately", async ({ page }) => {
  await page.goto("/login/?pending=github");
  await expect(page.getByRole("button", { name: "Signing in…" })).toBeDisabled();
});
