import { expect, test } from "playwright/test";

const item = {
  id: "00000000-0000-4000-8000-000000000001", title: "GPU memory hierarchy", notes: null, sourceUrl: null, sourcePlatform: null, sourceAuthor: null,
  originalDriveFileId: "original", thumbnailDriveFileId: "thumbnail", sha256: "a".repeat(64), detectedMimeType: "image/png", width: 1200, height: 900,
  favorite: false, archived: false, createdAt: "2026-08-20T10:00:00.000Z", capturedAt: "2026-08-20T10:00:00.000Z", processedAt: null, lastSeenAt: null,
  seenCount: 0, categoryIds: [], tagIds: [], folderState: "Inbox", reviewCount: 0, lastReviewedAt: null, reviewDueAt: "2026-08-21T10:00:00.000Z",
};

async function mockToday(page: import("playwright/test").Page, mode: "success" | "empty" | "error", infographics = [item]) {
  await page.route("**/api/infographics", async (route) => {
    if (mode === "error") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: mode === "empty" ? [] : infographics, categories: [], tags: [] }) });
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
  await expect(page.getByRole("link", { name: "Add", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Review", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Surprise me" })).toBeVisible();
});

test("uses the editorial design system and a wide owner workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/");

  await expect(page.locator(".sidebar")).toHaveCSS("width", "248px");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(245, 242, 234)");
  await expect(page.locator(".app-main")).toHaveCSS("margin-left", "248px");
  await expect(page.locator(".today-page > .page-header")).toBeVisible();
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

test("applies a persisted theme before the first client interaction", async ({ page }) => {
  const hydrationProblems: string[] = [];
  page.on("console", (message) => { if (/hydration|did not match/i.test(message.text())) hydrationProblems.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem("inf-theme", "dark"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const toggle = page.getByRole("button", { name: "Switch to light theme" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveAttribute("title", "Switch to light theme");
  await expect(toggle.locator("svg")).toHaveClass(/lucide-sun/);
  expect(hydrationProblems).toEqual([]);
});

test("persisted dark bootstrap keeps the pre-hydration toggle semantically neutral", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("inf-theme", "dark"));
  await page.route("**/_next/static/**", (route) => route.request().resourceType() === "script" ? route.abort() : route.continue());
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const toggle = page.getByRole("button", { name: "Color theme" });
  await expect(toggle).toBeDisabled();
  await expect(toggle).not.toHaveAttribute("aria-pressed", /.+/);
  await expect(toggle).toHaveAttribute("title", "Color theme");
  await expect(toggle.locator('[data-theme-icon="neutral"]')).toHaveCount(1);
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
  await expect(page.getByLabel("Recently added").getByRole("img", { name: "GPU memory hierarchy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review next" })).toBeVisible();
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBeTruthy();
});

test("orders Today content, excludes archived review rows, and preserves diagram labels", async ({ page }) => {
  const now = Date.now();
  const at = (days: number) => new Date(now + days * 86_400_000).toISOString();
  const infographics = [
    { ...item, id: "00000000-0000-4000-8000-000000000004", title: "Latest diagram", capturedAt: at(-1), reviewDueAt: at(3), width: 1600, height: 400 },
    { ...item, id: "00000000-0000-4000-8000-000000000002", title: "Oldest diagram", capturedAt: at(-4), reviewDueAt: at(1) },
    { ...item, id: "00000000-0000-4000-8000-000000000003", title: "Middle diagram", capturedAt: at(-2), reviewDueAt: at(2) },
    { ...item, id: "00000000-0000-4000-8000-000000000005", title: "Archived diagram", capturedAt: at(-5), reviewDueAt: at(0), archived: true },
  ];
  await mockToday(page, "success", infographics);
  await page.goto("/");

  await expect.poll(() => page.locator(".media-frame img").evaluateAll((images) => images.map((image) => image.getAttribute("alt")))).toEqual(["Latest diagram", "Middle diagram", "Oldest diagram"]);
  await expect(page.locator(".review-next li")).toHaveCount(3);
  await expect.poll(() => page.locator(".review-next li").evaluateAll((rows) => rows.map((row) => row.textContent?.trim()))).toEqual(["Oldest diagramDue tomorrow", "Middle diagramDue in 2 days", "Latest diagramDue in 3 days"]);
  await expect(page.locator(".review-next__thumbnail")).toHaveCount(3);
  await expect(page.locator(".review-next__thumbnail").first()).toHaveAttribute("alt", "Oldest diagram");
  await expect(page.locator(".review-next__thumbnail").first().evaluate((image) => ({ fit: getComputedStyle(image).objectFit, width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height }))).resolves.toEqual({ fit: "contain", width: 64, height: 48 });
  await expect(page.locator(".media-frame img").first().evaluate((image) => ({ fit: getComputedStyle(image).objectFit, background: getComputedStyle(image.parentElement!).backgroundColor }))).resolves.toEqual({ fit: "contain", background: "rgb(255, 254, 250)" });
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

test("public View Mode exposes an admin sign-in entrypoint", async ({ page }) => {
  await page.goto("/view/");

  const adminSignIn = page.getByRole("link", { name: "Admin sign in" });
  await expect(adminSignIn).toHaveAttribute("href", "/login/");
  await adminSignIn.click();
  await expect(page).toHaveURL(/\/login\/$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
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
