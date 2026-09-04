import { readFileSync } from "node:fs";
import { expect, test } from "playwright/test";
import { expectFocusAboveBottomNavigation, expectViewportAccessibility } from "./support/accessibility";

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

test("opens mobile Library filters, preserves URL state, and restores focus", async ({ page }) => {
  await mockLibrary(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/library/");
  const trigger = page.getByRole("button", { name: /^Filters(?: \(\d+\))?$/ });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Library filters" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Category").selectOption("gpu");
  await expect(page).toHaveURL(/category=gpu/);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText("Filters (1)");
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await expectViewportAccessibility(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFocusAboveBottomNavigation(page, trigger);
});

test("closes mobile Library filters when the desktop breakpoint takes over", async ({ page }) => {
  await mockLibrary(page);
  await page.setViewportSize({ width: 1099, height: 844 });
  await page.goto("/library/");
  const trigger = page.locator(".library-filter-trigger");
  await trigger.click();
  const dialog = page.locator('dialog[aria-label="Library filters"]');
  await expect(dialog).toBeVisible();

  await page.setViewportSize({ width: 1100, height: 844 });

  await expect(dialog).not.toHaveAttribute("open", "");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeHidden();
  await expect(trigger).not.toBeFocused();
  const desktopFilters = page.getByRole("form", { name: "Library filters" });
  await expect(desktopFilters).toBeVisible();
  await desktopFilters.getByLabel("Category").selectOption("gpu");
  await expect(page).toHaveURL(/category=gpu/);
});

test("orders mobile detail as media, learning, metadata, history, archive, and delete", async ({ page }) => {
  await mockLibrary(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/infographic/${item.id}`);
  await expect(page.getByRole("img", { name: item.title })).toBeVisible();

  const ordered = [
    page.locator(".detail-media"),
    page.getByRole("link", { name: "Start review" }),
    page.getByRole("region", { name: "Infographic metadata" }),
    page.getByRole("heading", { name: "Review history" }).locator(".."),
    page.getByRole("button", { name: "Archive" }),
    page.getByRole("button", { name: "Delete", exact: true }),
  ];
  const tops: number[] = [];
  for (const target of ordered) {
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    tops.push(box!.y);
  }
  expect(tops).toEqual([...tops].sort((left, right) => left - right));
  expect(new Set(tops).size).toBe(tops.length);
});

test("bounds owner detail loading, missing, and error states with a detail icon", async ({ page }) => {
  await page.route("**/api/infographics**", () => new Promise(() => undefined));
  await page.goto(`/infographic/${item.id}`);
  await expect(page.getByText("Loading infographic…", { exact: true })).toBeVisible();
  await expect(page.locator(".page-state")).toHaveAttribute("data-layout", "compact");
  await expect(page.locator(".page-state svg.lucide-image")).toHaveCount(1);

  await page.unrouteAll();
  await page.route("**/api/infographics**", (route) => {
    const url = new URL(route.request().url());
    return url.pathname === `/api/infographics/${item.id}`
      ? route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
      : route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: [], categories: [], tags: [] }) });
  });
  await page.reload();
  await expect(page.getByText("This infographic is no longer available.", { exact: true })).toBeVisible();
  await expect(page.locator(".page-state")).toHaveAttribute("data-layout", "compact");
  await expect(page.locator(".page-state svg.lucide-image")).toHaveCount(1);

  await page.unrouteAll();
  await page.route("**/api/infographics**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  await page.reload();
  await expect(page.getByText("This infographic could not be loaded. Try again.", { exact: true })).toBeVisible();
  await expect(page.locator(".page-state")).toHaveAttribute("data-layout", "compact");
  await expect(page.locator(".page-state svg.lucide-image")).toHaveCount(1);
});

test("searches, restores all server query filters through history, opens detail, favorites, archives, and confirms deletion", async ({ page }) => {
  const mock = await mockLibrary(page);
  await page.goto("/library/?q=%20MEMORY%20&category=gpu&tag=memory&sort=recent");
  await expect(page.locator(".library-page > .page-header")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Memory hierarchy" })).toBeVisible();
  const desktopFilters = page.getByRole("form", { name: "Library filters" });
  await expect(page.getByLabel("Search library")).toHaveValue("MEMORY");
  await expect(desktopFilters.getByLabel("Category")).toHaveValue("gpu");
  await expect(desktopFilters.getByLabel("Tag")).toHaveValue("memory");
  await page.reload();
  await expect(page.getByRole("link", { name: "Open Memory hierarchy" })).toBeVisible();
  await expect.poll(() => mock.catalogRequests.some((search) => search.includes("q=MEMORY") && search.includes("category=gpu") && search.includes("tag=memory") && search.includes("sort=recent"))).toBeTruthy();
  await desktopFilters.getByLabel("Favorite").check();
  await expect(page).toHaveURL(/favorite=true/);
  await page.goBack();
  await expect(desktopFilters.getByLabel("Favorite")).not.toBeChecked();
  await page.goForward();
  await expect(desktopFilters.getByLabel("Favorite")).toBeChecked();
  await page.screenshot({ fullPage: true, path: ".superpowers/sdd/2026-08-20-inf-mvp-implementation/task-11-library-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ fullPage: true, path: ".superpowers/sdd/2026-08-20-inf-mvp-implementation/task-11-library-mobile.png" });
  await page.getByRole("link", { name: "Open Memory hierarchy" }).click();
  await expect(page).toHaveURL(new RegExp(`/infographic/${item.id}`));
  await expect(page.getByRole("img", { name: "Memory hierarchy" })).toBeVisible();
  const detailWorkspace = page.locator(".detail-workspace");
  const detailLayout = page.locator(".detail-layout");
  await expect(detailWorkspace.locator(".media-canvas--detail")).toBeVisible();
  await expect.poll(() => detailWorkspace.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(/\s+/).length)).toBe(1);
  await expect(detailLayout).toHaveCSS("position", "static");
  await expect(detailLayout).toHaveAttribute("data-order", "learning-metadata-routine-history-archive-delete");
  expect((await detailLayout.locator(".detail-action-group .button").allTextContents()).map((text) => text.trim())).toEqual(["Start review", "Add to favorites", "Archive", "Delete"]);
  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await expectViewportAccessibility(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFocusAboveBottomNavigation(page, page.getByRole("button", { name: "Delete", exact: true }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => detailWorkspace.evaluate((element) => {
    const columns = getComputedStyle(element).gridTemplateColumns.split(/\s+/);
    return { columnCount: columns.length, inspectorWidth: Number.parseFloat(columns.at(-1) ?? "0") };
  })).toEqual({ columnCount: 2, inspectorWidth: 340 });
  await expect(detailLayout).toHaveCSS("position", "sticky");
  await page.setViewportSize({ width: 390, height: 844 });
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
  await expect(confirm).toHaveCSS("background-color", "rgb(178, 58, 58)");
  await expect(confirm).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  const darkConfirm = page.getByRole("button", { name: "Delete infographic" });
  await expect(darkConfirm).toHaveCSS("background-color", "rgb(255, 141, 141)");
  await expect(darkConfirm).toHaveCSS("color", "rgb(12, 15, 13)");
  await darkConfirm.click();
  const dialog = page.getByRole("dialog", { name: "Delete infographic?" });
  await expect(dialog).toHaveAttribute("aria-busy", "true");
  await expect(dialog).toBeFocused();
  await expect(page.locator(".detail-page__content")).toHaveAttribute("inert", "");
  await page.keyboard.press("Tab");
  await expect(dialog).toBeFocused();
  const deleting = page.getByRole("button", { name: "Deleting…" });
  await expect(deleting).toBeDisabled();
  await expect(deleting).toHaveCSS("background-color", "rgb(32, 38, 31)");
  await expect(deleting).toHaveCSS("color", "rgb(116, 123, 113)");
  await expect.poll(mock.deleteCalls).toBe(1);
  mock.releaseDelete();
  await expect(page.getByRole("status")).toHaveText("The infographic could not be deleted. Try again.");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
  await expect(page.locator(".detail-page__content")).not.toHaveAttribute("inert", "");
  expect(mock.deleteCalls()).toBe(1);
});

test("keeps pending delete focus anchored until successful navigation", async ({ page }) => {
  const mock = await mockLibrary(page, { pauseDelete: true });
  await page.goto(`/infographic/${item.id}`);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete infographic" }).click();

  const dialog = page.getByRole("dialog", { name: "Delete infographic?" });
  await expect(dialog).toHaveAttribute("aria-busy", "true");
  await expect(dialog).toBeFocused();
  await expect(page.locator(".detail-page__content")).toHaveAttribute("inert", "");
  await expect.poll(mock.deleteCalls).toBe(1);
  mock.releaseDelete();
  await expect(page).toHaveURL(/\/library\/$/);
  await expect(dialog).toBeHidden();
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
  await expect(page.locator(".page-state")).toHaveAttribute("data-layout", "compact");
  await expect(page.locator(".page-state svg.lucide-library")).toHaveCount(1);
  await page.unrouteAll();
  await page.route("**/api/infographics**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: [], categories: [], tags: [], page: 1, pageSize: 24, totalItems: 0, totalPages: 0 }) }));
  await page.reload();
  await expect(page.getByText("Library is empty.", { exact: true })).toBeVisible();
  await expect(page.locator(".page-state")).toHaveAttribute("data-layout", "compact");
  await expect(page.locator(".page-state svg.lucide-library")).toHaveCount(1);
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
  await expect(page.locator(".page-state")).toHaveAttribute("data-layout", "compact");
  await expect(page.locator(".page-state svg.lucide-library")).toHaveCount(1);
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
  await page.getByRole("form", { name: "Library filters" }).getByLabel("Favorite").check();
  await expect(page).toHaveURL(/favorite=true/);
  await expect(page).not.toHaveURL(/page=/);

  // Deep-linking to an out-of-range page clamps to the last available slice.
  await page.goto("/library/?page=99");
  await expect(page.getByRole("link", { name: "Open Second page item" })).toBeVisible();
  await expect(page.locator(".library-pager")).toContainText("Page 2 of 2");
});
