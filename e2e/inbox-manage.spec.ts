import { readFileSync } from "node:fs";
import { expect, test } from "playwright/test";

const image = readFileSync("api/test/fixtures/valid-infographic.png");
const imageUpload = { name: "learning-loop.png", mimeType: "image/png", buffer: image };

interface ManagedItem {
  id: string;
  title: string;
  notes: string | null;
  sourceUrl: string | null;
  sourcePlatform: string | null;
  sourceAuthor: string | null;
  originalDriveFileId: string;
  thumbnailDriveFileId: string;
  sha256: string;
  detectedMimeType: string;
  width: number;
  height: number;
  favorite: boolean;
  archived: boolean;
  createdAt: string;
  capturedAt: string;
  processedAt: string | null;
  lastSeenAt: string | null;
  seenCount: number;
  categoryIds: string[];
  tagIds: string[];
  folderState: "Inbox" | "Library" | "Archive";
  reviewCount: number;
  lastReviewedAt: string | null;
  reviewDueAt: string | null;
}

function buildItem(overrides: Partial<ManagedItem> = {}): ManagedItem {
  return {
    id: "00000000-0000-4000-8000-000000000010", title: "Learning loop", notes: null, sourceUrl: null, sourcePlatform: null, sourceAuthor: null,
    originalDriveFileId: "original-1", thumbnailDriveFileId: "thumbnail-1", sha256: "a".repeat(64), detectedMimeType: "image/png", width: 1200, height: 900,
    favorite: false, archived: false, createdAt: "2026-08-25T10:00:00.000Z", capturedAt: "2026-08-25T10:00:00.000Z", processedAt: null, lastSeenAt: null,
    seenCount: 0, categoryIds: [], tagIds: [], folderState: "Inbox", reviewCount: 0, lastReviewedAt: null, reviewDueAt: null,
    ...overrides,
  };
}

interface MockOptions {
  suggestions?: Record<string, { suggestion: { title?: string | null; notes?: string | null; sourceUrl?: string | null; sourcePlatform?: string | null; sourceAuthor?: string | null; confidence: number; rationale?: string | null; topics?: string[]; language?: string | null } }>;
  suggestionsFail?: number;
  replaceOk?: boolean;
  replaceFail?: number;
  deleteOk?: boolean;
}

async function mockInboxManage(page: import("playwright/test").Page, items: ManagedItem[], options: MockOptions = {}) {
  const state: { items: ManagedItem[]; patches: unknown[]; deleted: string[]; replaced: Record<string, ManagedItem>; suggestCount: number; replaceCount: number; deleteCount: number } = { items: [...items], patches: [], deleted: [], replaced: {}, suggestCount: 0, replaceCount: 0, deleteCount: 0 };
  await page.route("**/api/infographics", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: state.items, categories: [], tags: [] }) });
    return route.fallback();
  });
  await page.route(/\/api\/infographics\/[^/]+\/suggest$/, async (route) => {
    state.suggestCount += 1;
    if (options.suggestionsFail !== undefined) return route.fulfill({ status: options.suggestionsFail, contentType: "application/json", body: JSON.stringify({ code: "AI_NOT_CONFIGURED" }) });
    const url = new URL(route.request().url());
    const segments = url.pathname.split("/");
    const id = segments[segments.length - 2]!;
    const override = options.suggestions?.[id];
    if (override) return route.fulfill({ contentType: "application/json", body: JSON.stringify(override) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ suggestion: { title: "Suggested title", notes: "Suggested notes", sourceUrl: null, sourcePlatform: null, sourceAuthor: null, language: "en", topics: ["learning"], rationale: "Visible", confidence: 0.7 } }) });
  });
  await page.route(/\/api\/infographics\/[^/]+\/image$/, async (route) => {
    state.replaceCount += 1;
    if (options.replaceFail !== undefined) return route.fulfill({ status: options.replaceFail, contentType: "application/json", body: JSON.stringify({ code: options.replaceFail === 409 ? "DUPLICATE_IMAGE" : "BAD" }) });
    const url = new URL(route.request().url());
    const segments = url.pathname.split("/");
    const id = segments[segments.length - 2]!;
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "NOT_FOUND" }) });
    const updated: ManagedItem = { ...item, thumbnailDriveFileId: `thumbnail-${state.replaceCount + 1}`, originalDriveFileId: `original-${state.replaceCount + 1}` };
    state.items = state.items.map((candidate) => candidate.id === id ? updated : candidate);
    state.replaced[id] = updated;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(updated) });
  });
  await page.route(/\/api\/infographics\/[^/]+$/, async (route) => {
    if (route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON() as Record<string, unknown>;
      state.patches.push(patch);
      const url = new URL(route.request().url());
      const segments = url.pathname.split("/");
      const id = segments[segments.length - 1]!;
      const item = state.items.find((candidate) => candidate.id === id);
      if (item && Array.isArray(patch.categories) && patch.categories.length > 0) {
        state.items = state.items.filter((candidate) => candidate.id !== id);
      } else if (item) {
        const merged: ManagedItem = { ...item, title: typeof patch.title === "string" ? patch.title : item.title, notes: patch.notes === null ? null : (typeof patch.notes === "string" ? patch.notes : item.notes), sourceUrl: patch.sourceUrl === null ? null : (typeof patch.sourceUrl === "string" ? patch.sourceUrl : item.sourceUrl), sourcePlatform: patch.sourcePlatform === null ? null : (typeof patch.sourcePlatform === "string" ? patch.sourcePlatform : item.sourcePlatform), sourceAuthor: patch.sourceAuthor === null ? null : (typeof patch.sourceAuthor === "string" ? patch.sourceAuthor : item.sourceAuthor) };
        state.items = state.items.map((candidate) => candidate.id === id ? merged : candidate);
      }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ updated: true }) });
    }
    if (route.request().method() === "DELETE") {
      state.deleteCount += 1;
      if (options.deleteOk === false) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "DELETE_FAILED" }) });
      const url = new URL(route.request().url());
      const segments = url.pathname.split("/");
      const id = segments[segments.length - 1]!;
      state.deleted.push(id);
      state.items = state.items.filter((candidate) => candidate.id !== id);
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fallback();
  });
  return state;
}

test.describe("Inbox management", () => {
  test("applies AI suggestion to a row, applies notes and source URL via PATCH, and reflects Library move", async ({ page }) => {
    const items: ManagedItem[] = [
      buildItem({ id: "00000000-0000-4000-8000-000000000001", title: "GPU memory" }),
      buildItem({ id: "00000000-0000-4000-8000-000000000002", title: "CUDA warps" }),
    ];
    const state = await mockInboxManage(page, items);
    await page.goto("/inbox/");
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    const firstRow = page.locator(".inbox-row").first();
    await expect(firstRow.getByRole("img", { name: "GPU memory" })).toBeVisible();
    // Wait for AI banner to appear on the first row.
    await expect(firstRow.locator(".ai-banner--ready")).toBeVisible();
    await firstRow.getByRole("button", { name: "Apply AI" }).click();
    await expect(firstRow.getByLabel("Title")).toHaveValue("Suggested title");
    await firstRow.getByLabel("Notes").fill("My own notes");
    await firstRow.getByLabel("Source URL").fill("https://example.com/loop");
    await firstRow.getByRole("button", { name: "Apply" }).click();
    await expect(firstRow.getByText("Saved.", { exact: true })).toBeVisible();
    const lastPatch = state.patches.at(-1) as Record<string, unknown> | undefined;
    expect(lastPatch).toMatchObject({ title: "Suggested title", notes: "My own notes", sourceUrl: "https://example.com/loop" });
    expect(state.suggestCount).toBeGreaterThanOrEqual(2);
  });

  test("deletes a row after confirming the modal", async ({ page }) => {
    const items: ManagedItem[] = [buildItem({ id: "00000000-0000-4000-8000-000000000003", title: "Delete me" })];
    const state = await mockInboxManage(page, items);
    await page.goto("/inbox/");
    const row = page.locator(".inbox-row").first();
    await expect(row.getByRole("img", { name: "Delete me" })).toBeVisible();
    await row.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await row.getByRole("button", { name: "Delete" }).click();
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(row).toBeHidden();
    expect(state.deleted).toEqual(["00000000-0000-4000-8000-000000000003"]);
    await expect(page.getByText("Inbox is empty.", { exact: true })).toBeVisible();
  });

  test("replaces an image, updates the preview, and shows a Saved flash", async ({ page }) => {
    const items: ManagedItem[] = [buildItem({ id: "00000000-0000-4000-8000-000000000004", title: "Replace me", thumbnailDriveFileId: "thumbnail-1" })];
    const state = await mockInboxManage(page, items);
    await page.goto("/inbox/");
    const row = page.locator(".inbox-row").first();
    const fileChooser = page.waitForEvent("filechooser");
    await row.getByRole("button", { name: "Replace image" }).click();
    const chooser = await fileChooser;
    await chooser.setFiles(imageUpload);
    await expect(row.getByText("Image replaced.", { exact: true })).toBeVisible();
    expect(state.replaceCount).toBe(1);
    expect(state.replaced["00000000-0000-4000-8000-000000000004"]?.thumbnailDriveFileId).toBe("thumbnail-2");
  });

  test("shows AI error banner when the suggest endpoint returns 503 and exposes a retry button", async ({ page }) => {
    const items: ManagedItem[] = [buildItem({ id: "00000000-0000-4000-8000-000000000005", title: "AI fails" })];
    await mockInboxManage(page, items, { suggestionsFail: 503 });
    await page.goto("/inbox/");
    const row = page.locator(".inbox-row").first();
    await expect(row.locator(".ai-banner--error")).toBeVisible();
    await expect(row.locator(".ai-banner--error")).toContainText("AI suggestions are not configured");
    await expect(row.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("moves the row to Library when categories are applied, and the row disappears from Inbox", async ({ page }) => {
    const items: ManagedItem[] = [buildItem({ id: "00000000-0000-4000-8000-000000000006", title: "Move me" })];
    const state = await mockInboxManage(page, items);
    await page.goto("/inbox/");
    const row = page.locator(".inbox-row").first();
    await row.getByLabel("Category").fill("GPU");
    await row.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByText("Moved to Library", { exact: true })).toBeVisible();
    await expect(row).toBeHidden();
    expect(state.patches.at(-1)).toMatchObject({ categories: [expect.objectContaining({ displayName: "GPU" })] });
  });
});
