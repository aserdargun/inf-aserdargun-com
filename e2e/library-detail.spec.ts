import { readFileSync } from "node:fs";
import { expect, test } from "playwright/test";

const category = { id: "00000000-0000-4000-8000-000000000021", displayName: "GPU", normalizedName: "gpu", slug: "gpu" };
const tag = { id: "00000000-0000-4000-8000-000000000022", displayName: "Memory", normalizedName: "memory", slug: "memory" };
const item = {
  id: "00000000-0000-4000-8000-000000000020", title: "Memory hierarchy", notes: "A concise memory map.",  originalDriveFileId: "original-memory", thumbnailDriveFileId: "thumbnail-memory", sha256: "a".repeat(64), detectedMimeType: "image/png", width: 1600, height: 900,
  favorite: false, archived: false, createdAt: "2026-08-20T10:00:00.000Z", capturedAt: "2026-08-20T10:00:00.000Z", processedAt: "2026-08-20T10:01:00.000Z", lastSeenAt: "2026-08-20T10:02:00.000Z",
  seenCount: 3, categoryIds: [category.id], tagIds: [tag.id], folderState: "Library", reviewCount: 2, lastReviewedAt: "2026-08-20T10:03:00.000Z", reviewDueAt: "2026-08-21T10:00:00.000Z",
};
const image = readFileSync("api/test/fixtures/valid-infographic.png");

async function mockLibrary(page: import("playwright/test").Page, options: { deleteStatus?: number; pauseDelete?: boolean } = {}) {
  let current = { ...item };
  const patches: unknown[] = [];
  let deleted = false;
  let deleteCalls = 0;
  let publicCatalogCalls = 0;
  const catalogRequests: string[] = [];
  let releaseDelete: (() => void) | undefined;
  await page.route("**/api/infographics**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/infographics" && request.method() === "GET") {
      catalogRequests.push(url.search);
      const filtered = url.searchParams.get("q") === "absent";
      const infographics = deleted || filtered ? [] : [current];
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics, categories: [category], tags: [tag], page: 1, pageSize: 24, totalItems: infographics.length, totalPages: infographics.length === 0 ? 0 : 1 }) });
    }
    if (request.url().endsWith(`/api/infographics/${item.id}`) && request.method() === "GET") {
      return deleted ? route.fulfill({ status: 404, contentType: "application/json", body: "{}" }) : route.fulfill({ contentType: "application/json", body: JSON.stringify(current) });
    }
    if (request.url().endsWith(`/api/infographics/${item.id}`) && request.method() === "PATCH") {
      const patch = request.postDataJSON(); patches.push(patch); current = { ...current, ...patch };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ updated: true }) });
    }
    if (request.url().endsWith(`/api/infographics/${item.id}`) && request.method() === "DELETE") {
      deleteCalls += 1;
      if (options.pauseDelete) await new Promise<void>((resolve) => { releaseDelete = resolve; });
      if ((options.deleteStatus ?? 204) >= 400) return route.fulfill({ status: options.deleteStatus, contentType: "application/json", body: "{}" });
      deleted = true; return route.fulfill({ status: 204 });
    }
    return route.fallback();
  });
  await page.route("**/api/public/images/**", (route) => route.fulfill({ body: image, contentType: "image/png" }));
  await page.route("**/api/public/infographics**", (route) => { publicCatalogCalls += 1; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [], page: 1, pageSize: 12, totalItems: 0, totalPages: 0 }) }); });
  return { patches, deleteCalls: () => deleteCalls, publicCatalogCalls: () => publicCatalogCalls, catalogRequests, releaseDelete: () => releaseDelete?.() };
}

test("searches, restores all server query filters through history, opens detail, favorites, archives, and confirms deletion", async ({ page }) => {
  const mock = await mockLibrary(page);
  await page.goto("/library/?q=%20MEMORY%20&category=gpu&tag=memory&sort=recent");
  await expect(page.locator(".library-page > .page-header")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Memory hierarchy" })).toBeVisible();
  await expect(page.getByLabel("Search library")).toHaveValue("MEMORY");
  await expect(page.getByLabel("Category")).toHaveValue("gpu");
  await expect(page.getByLabel("Tag")).toHaveValue("memory");
  await page.reload();
  await expect(page.getByRole("link", { name: "Open Memory hierarchy" })).toBeVisible();
  await expect.poll(() => mock.catalogRequests.some((search) => search.includes("q=MEMORY") && search.includes("category=gpu") && search.includes("tag=memory") && search.includes("sort=recent"))).toBeTruthy();
  await page.getByLabel("Favorite").check();
  await page.getByLabel("Source").check();
  await expect(page).toHaveURL(/favorite=true.*source=true/);
  await page.goBack();
  await expect(page.getByLabel("Favorite")).toBeChecked();
  await expect(page.getByLabel("Source")).not.toBeChecked();
  await page.goForward();
  await expect(page.getByLabel("Favorite")).toBeChecked();
  await expect(page.getByLabel("Source")).toBeChecked();
  await page.screenshot({ fullPage: true, path: ".superpowers/sdd/2026-08-20-inf-mvp-implementation/task-11-library-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ fullPage: true, path: ".superpowers/sdd/2026-08-20-inf-mvp-implementation/task-11-library-mobile.png" });
  await page.getByRole("link", { name: "Open Memory hierarchy" }).click();
  await expect(page).toHaveURL(new RegExp(`/infographic/${item.id}`));
  await expect(page.getByRole("img", { name: "Memory hierarchy" })).toBeVisible();
  await expect(page.locator(".detail-image")).toHaveCSS("object-fit", "contain");
  await page.screenshot({ fullPage: true, path: ".superpowers/sdd/2026-08-20-inf-mvp-implementation/task-11-detail-mobile.png" });
  await page.getByRole("button", { name: "Add to favorites" }).click();
  await expect(page.getByRole("button", { name: "Remove from favorites" })).toBeVisible();
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page).toHaveURL(/\/library\//);
  expect(mock.patches).toEqual([{ favorite: true }, { archived: true }]);
  expect(mock.publicCatalogCalls()).toBe(0);

  await page.goto(`/infographic/${item.id}`);
  const deleteTrigger = page.getByRole("button", { name: "Delete" });
  await deleteTrigger.click();
  await expect(page.getByRole("dialog", { name: "Delete infographic?" })).toContainText("Memory hierarchy will be moved to Trash.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Delete infographic?" })).toBeHidden();
  await expect(deleteTrigger).toBeFocused();
  await deleteTrigger.click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(deleteTrigger).toBeFocused();
  await deleteTrigger.click();
  await page.getByRole("button", { name: "Delete infographic" }).click();
  await expect(page).toHaveURL(/\/library\//);
});

test("prevents a duplicate delete and keeps a failed delete generic", async ({ page }) => {
  const mock = await mockLibrary(page, { deleteStatus: 500, pauseDelete: true });
  await page.goto(`/infographic/${item.id}`);
  await page.getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("button", { name: "Delete infographic" });
  await confirm.click();
  await expect(page.getByRole("button", { name: "Deleting…" })).toBeDisabled();
  await expect.poll(mock.deleteCalls).toBe(1);
  mock.releaseDelete();
  await expect(page.getByRole("status")).toHaveText("The infographic could not be deleted. Try again.");
  expect(mock.deleteCalls()).toBe(1);
});

test("keeps the latest URL query when an older Library response resolves last", async ({ page }) => {
  const second = { ...item, id: "00000000-0000-4000-8000-000000000023", title: "Second query" };
  let delayedFirst: import("playwright/test").Route | undefined;
  let delayedSecond: import("playwright/test").Route | undefined;
  await page.route("**/api/infographics**", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname !== "/api/infographics" || request.method() !== "GET") return route.fallback();
    const q = url.searchParams.get("q");
    if (q === "first") { delayedFirst = route; return; }
    if (q === "second") { delayedSecond = route; return; }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: [item], categories: [category], tags: [tag], page: 1, pageSize: 24, totalItems: 1, totalPages: 1 }) });
  });
  await page.route("**/api/public/images/**", (route) => route.fulfill({ body: image, contentType: "image/png" }));
  await page.goto("/library/?q=ready");
  await expect(page.getByRole("link", { name: "Open Memory hierarchy" })).toBeVisible();
  const search = page.getByLabel("Search library");
  await search.fill("first");
  await expect.poll(() => delayedFirst !== undefined).toBeTruthy();
  await search.fill("second");
  await expect.poll(() => delayedSecond !== undefined).toBeTruthy();
  await delayedSecond!.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: [second], categories: [category], tags: [tag], page: 1, pageSize: 24, totalItems: 1, totalPages: 1 }) });
  await expect(page.getByRole("link", { name: "Open Second query" })).toBeVisible();
  await delayedFirst!.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: [], categories: [category], tags: [tag], page: 1, pageSize: 24, totalItems: 0, totalPages: 0 }) });
  await expect(page).toHaveURL(/\/library\/\?q=second$/);
  await expect(search).toHaveValue("second");
  await expect(page.getByRole("link", { name: "Open Second query" })).toBeVisible();
  await expect(page.getByText("No infographics match these filters.", { exact: true })).toBeHidden();
});

test("renders Library loading, empty, no-results, and safe error states", async ({ page }) => {
  await page.route("**/api/infographics**", () => new Promise(() => undefined));
  await page.goto("/library/");
  await expect(page.getByText("Loading Library…", { exact: true })).toBeVisible();
  await page.unrouteAll();
  await page.route("**/api/infographics**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: [], categories: [], tags: [], page: 1, pageSize: 24, totalItems: 0, totalPages: 0 }) }));
  await page.reload();
  await expect(page.getByText("Library is empty.", { exact: true })).toBeVisible();
  await page.goto("/library/?q=absent&favorite=true");
  await expect(page.getByText("No infographics match these filters.", { exact: true })).toBeVisible();
  await page.unrouteAll();
  await mockLibrary(page);
  await page.goto("/library/?q=absent");
  await expect(page.getByText("No infographics match these filters.", { exact: true })).toBeVisible();
  await page.getByLabel("Library filters").getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/library\/$/);
  await page.unrouteAll();
  await page.route("**/api/infographics**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  await page.reload();
  await expect(page.getByText("Library could not be loaded. Try again.", { exact: true })).toBeVisible();
});

test("paginates the Library, syncs the URL, resets on filter change, and clamps out-of-range pages", async ({ page }) => {
  const first = { ...item, id: "00000000-0000-4000-8000-000000000030", title: "First page item" };
  const second = { ...item, id: "00000000-4000-4000-8000-000000000030", title: "Second page item" };
  let calls: string[] = [];
  await page.route("**/api/infographics**", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const url = new URL(route.request().url());
    calls.push(url.search);
    const requestedPage = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
    // Mirror the server's clamp: out-of-range pages snap back to the last valid slice.
    const effectivePage = requestedPage >= 2 ? 2 : 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: effectivePage === 2 ? [second] : [first], categories: [category], tags: [tag], page: effectivePage, pageSize: 24, totalItems: 2, totalPages: 2 }) });
  });
  await page.route("**/api/public/images/**", (route) => route.fulfill({ body: image, contentType: "image/png" }));

  await page.goto("/library/");
  await expect(page.getByRole("link", { name: "Open First page item" })).toBeVisible();
  await expect(page.locator(".library-pager")).toContainText("Page 1 of 2");
  await expect(page.locator(".library-pager")).toContainText("2 infographics");

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByRole("link", { name: "Open Second page item" })).toBeVisible();
  await expect(page).toHaveURL(/page=2$/);
  await expect(page.locator(".library-pager")).toContainText("Page 2 of 2");

  await page.goBack();
  await expect(page.getByRole("link", { name: "Open First page item" })).toBeVisible();
  await expect(page).toHaveURL(/\/library\/$/);

  // Changing a filter must reset the page back to 1.
  await page.getByLabel("Favorite").check();
  await expect(page).toHaveURL(/favorite=true/);
  await expect(page).not.toHaveURL(/page=/);

  // Deep-linking to an out-of-range page clamps to the last available slice.
  await page.goto("/library/?page=99");
  await expect(page.getByRole("link", { name: "Open Second page item" })).toBeVisible();
  await expect(page.locator(".library-pager")).toContainText("Page 2 of 2");
});
