import { readFileSync } from "node:fs";
import { expect, test } from "playwright/test";

const image = readFileSync("api/test/fixtures/valid-infographic.png");
const imageUpload = { name: "learning-loop.png", mimeType: "image/png", buffer: image };
const item = {
  id: "00000000-0000-4000-8000-000000000010", title: "Learning loop", notes: null,  originalDriveFileId: "original", thumbnailDriveFileId: "thumbnail", sha256: "a".repeat(64), detectedMimeType: "image/png", width: 1200, height: 900,
  favorite: false, archived: false, createdAt: "2026-08-20T10:00:00.000Z", capturedAt: "2026-08-20T10:00:00.000Z", processedAt: null, lastSeenAt: null,
  seenCount: 0, categoryIds: [], tagIds: [], folderState: "Inbox", reviewCount: 0, lastReviewedAt: null, reviewDueAt: null,
};
const category = { id: "00000000-0000-4000-8000-000000000011", displayName: "GPU", normalizedName: "gpu", slug: "gpu" };

async function mockCaptureAndInbox(page: import("playwright/test").Page) {
  let captured = false;
  let processed = false;
  let tags: unknown[] = [];
  const patches: { categories?: unknown[]; tags?: unknown[] }[] = [];
  await page.route("**/api/infographics**", async (route) => {
    if (route.request().method() === "POST") {
      captured = true;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ kind: "created", infographic: item }) });
    }
    if (route.request().method() === "GET") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({
        infographics: captured && !processed ? [item] : [], categories: [category], tags,
      }) });
    }
    if (route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON() as { categories?: unknown[]; tags?: unknown[] };
      patches.push(patch);
      tags = patch.tags ?? [];
      processed = true;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ updated: true }) });
    }
    return route.fallback();
  });
  await page.route("**/api/sync", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ imported: 1, duplicates: 0, rejected: 0 }) }));
  return { patches };
}

test("uploads without metadata, then categorizes and tags in Inbox", async ({ page }) => {
  const mock = await mockCaptureAndInbox(page);
  await page.goto("/add/");
  await page.getByLabel("Choose infographic").setInputFiles(imageUpload);
  await expect(page.getByRole("img", { name: "Infographic preview" })).toBeVisible();
  await page.getByRole("button", { name: "Save to Inbox" }).click();
  await expect(page).toHaveURL(/\/inbox\//);
  await page.getByLabel("Category").fill("GPU");
  await page.getByLabel("Tags").fill(" Memory, cuda, MEMORY ");
  await page.getByRole("button", { name: "Move to Library" }).click();
  await expect(page.getByText("Moved to Library", { exact: true })).toBeVisible();
  expect(mock.patches).toEqual([{
    categories: [category],
    tags: [
      { id: expect.any(String), displayName: "Memory", normalizedName: "memory", slug: "memory" },
      { id: expect.any(String), displayName: "cuda", normalizedName: "cuda", slug: "cuda" },
    ],
  }]);
});

test("fills Category and Tags via OpenAI on image add, then PATCHes them after capture", async ({ page }) => {
  const knownCategory = { id: "00000000-0000-4000-8000-000000000021", displayName: "AI & Machine Learning", normalizedName: "ai & machine learning", slug: "ai-machine-learning" };
  const knownTag = { id: "00000000-0000-4000-8000-000000000022", displayName: "memory", normalizedName: "memory", slug: "memory" };
  let capturedId: string | null = null;
  const patches: { categories?: unknown[]; tags?: unknown[] }[] = [];
  await page.route("**/api/infographics/suggest-metadata", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: 1,
        model: "gpt-4o-mini",
        generatedAt: "2026-08-24T08:00:00.000Z",
        suggestion: {
          title: "Understanding LLM inference",
          notes: "How transformers process tokens.",
          language: "en",
          category: "AI & Machine Learning",
          topics: ["memory", "cuda"],
          rationale: "Visible headline + handle.",
          confidence: 0.91,
        },
      }),
    });
  });
  await page.route("**/api/infographics**", async (route) => {
    if (route.request().method() === "POST" && new URL(route.request().url()).pathname === "/api/infographics") {
      capturedId = item.id;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ kind: "created", infographicId: item.id, title: item.title, original: { id: "original" }, thumbnail: { id: "thumbnail" } }) });
    }
    if (route.request().method() === "GET") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: [], categories: [knownCategory], tags: [knownTag] }) });
    }
    if (route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON() as { categories?: unknown[]; tags?: unknown[] };
      patches.push(patch);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ updated: true }) });
    }
    return route.fallback();
  });

  await page.goto("/add/");
  await page.getByLabel("Choose infographic").setInputFiles(imageUpload);
  await expect(page.getByRole("img", { name: "Infographic preview" })).toBeVisible();
  await expect(page.locator(".ai-banner--ready")).toBeVisible();
  await expect(page.getByText(/will move to/i)).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("Understanding LLM inference");
  await expect(page.getByLabel("Category")).toHaveValue("AI & Machine Learning");
  await expect(page.getByLabel("Tags")).toHaveValue("memory, cuda");
  await expect(page.getByLabel("Notes")).toHaveValue("How transformers process tokens.");
  await page.getByRole("button", { name: "Save to Inbox" }).click();
  await expect(page).toHaveURL(/\/inbox\//);
  expect(capturedId).toBe(item.id);
  expect(patches).toEqual([{
    categories: [expect.objectContaining({ displayName: "AI & Machine Learning" })],
    tags: [
      expect.objectContaining({ displayName: "memory" }),
      expect.objectContaining({ displayName: "cuda" }),
    ],
  }]);
});

test("retries AI filling from the capture form error banner when suggest-metadata fails", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/infographics/suggest-metadata", async (route) => {
    attempts += 1;
    if (attempts === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "AI_NOT_CONFIGURED" }) });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: 1,
        model: "gpt-4o-mini",
        generatedAt: "2026-08-24T08:00:00.000Z",
        suggestion: { title: "Retry title", notes: null,language: "en", category: null, topics: [], rationale: null, confidence: 0.4 },
      }),
    });
  });
  await page.route("**/api/infographics**", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: [], categories: [], tags: [] }) });
    return route.fallback();
  });
  await page.goto("/add/");
  await page.getByLabel("Choose infographic").setInputFiles(imageUpload);
  await expect(page.getByRole("img", { name: "Infographic preview" })).toBeVisible();
  await expect(page.locator(".ai-banner--error")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".ai-banner--ready")).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("Retry title");
  expect(attempts).toBe(2);
});

test("keeps capture media visible beside details on desktop and stacks the workflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/add/");

  const workspace = page.locator(".capture-workspace");
  await expect(workspace).toBeVisible();
  await expect(workspace.locator(":scope > .capture-workspace__media")).toHaveCount(1);
  await expect(workspace.locator(":scope > .capture-workspace__details")).toHaveCount(1);
  await expect.poll(() => workspace.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => workspace.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBeTruthy();
});

test("keeps Drive sync in the Inbox page header", async ({ page }) => {
  await mockCaptureAndInbox(page);
  await page.goto("/inbox/");

  const header = page.locator(".inbox-page > .page-header");
  await expect(header).toBeVisible();
  await expect(header.locator(".page-header__actions").getByRole("button", { name: "Sync Drive" })).toBeVisible();
});

test("uses one 44px native picker with keyboard, drop, and clipboard image paths", async ({ page }) => {
  await page.setViewportSize({ width: 427, height: 922 });
  await page.goto("/add/");
  const dropzone = page.getByTestId("capture-dropzone");
  const paste = page.getByRole("button", { name: /Paste from clipboard/ });
  const choose = page.getByLabel("Choose infographic");
  await expect(page.getByRole("button", { name: "Choose image" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose infographic" })).toHaveCount(1);
  for (const control of [paste, choose, page.getByLabel("Title"), page.getByLabel("Notes"), page.getByRole("button", { name: "Save to Inbox" })]) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await paste.focus();
  await expect(paste).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(choose).toBeFocused();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles(imageUpload);
  await expect(page.getByRole("img", { name: "Infographic preview" })).toBeVisible();

  await page.reload();
  await expect(dropzone).toBeVisible();
  const spaceChooser = page.waitForEvent("filechooser");
  await page.getByLabel("Choose infographic").focus();
  await page.keyboard.press("Space");
  await (await spaceChooser).setFiles(imageUpload);
  await expect(page.getByRole("img", { name: "Infographic preview" })).toBeVisible();

  await page.reload();
  await expect(dropzone).toBeVisible();
  await dropzone.evaluate((node, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes as number[])], "drop.png", { type: "image/png" }));
    node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, [...image]);
  await expect(page.getByRole("img", { name: "Infographic preview" })).toBeVisible();

  await page.reload();
  await expect(dropzone).toBeVisible();
  await page.evaluate((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes as number[])], "clipboard.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
  }, [...image]);
  await expect(page.getByRole("img", { name: "Infographic preview" })).toBeVisible();

  await page.reload();
  await expect(dropzone).toBeVisible();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "not an image");
    document.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
  });
  await expect(page.getByRole("status")).toContainText("Choose an image file.");
});

test("prevents duplicate saves and keeps server errors safe", async ({ page }) => {
  let requests = 0;
  let finishRequest: (() => void) | undefined;
  await page.route("**/api/infographics", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: [], categories: [], tags: [] }) });
    requests += 1;
    await new Promise<void>((resolve) => { finishRequest = resolve; });
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "private backend detail" }) });
  });
  await page.goto("/add/");
  await page.getByLabel("Choose infographic").setInputFiles(imageUpload);
  const save = page.getByRole("button", { name: "Save to Inbox" });
  await save.click();
  await expect(page.getByRole("button", { name: "Saving to Inbox…" })).toBeDisabled();
  expect(requests).toBe(1);
  finishRequest?.();
  await expect(page.getByText("The infographic could not be saved. Try again.", { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test("rejects unsupported and oversized files before upload", async ({ page }) => {
  await page.goto("/add/");
  const input = page.getByLabel("Choose infographic");
  await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
  await expect(page.getByRole("status")).toContainText("Choose an image file.");
  await input.setInputFiles({ name: "too-large.png", mimeType: "image/png", buffer: Buffer.alloc(20_000_001) });
  await expect(page.getByRole("status")).toContainText("This image is too large. Choose an image up to 20 MB.");
});

test("renders Inbox loading, empty, error, and sync feedback states", async ({ page }) => {
  await page.route("**/api/infographics", () => new Promise(() => undefined));
  await page.goto("/inbox/");
  await expect(page.getByText("Loading Inbox…", { exact: true })).toBeVisible();
  await page.unrouteAll();

  await page.route("**/api/infographics", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: [], categories: [], tags: [] }) }));
  let finishSync: (() => void) | undefined;
  await page.route("**/api/sync", async (route) => {
    await new Promise<void>((resolve) => { finishSync = resolve; });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ imported: 1, duplicates: 0, rejected: 0 }) });
  });
  await page.reload();
  await expect(page.getByText("Inbox is empty.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sync Drive" }).click();
  await expect(page.getByRole("status")).toContainText("Syncing Drive…");
  finishSync?.();
  await expect(page.getByRole("button", { name: "Sync Drive" })).toBeEnabled();

  await page.unrouteAll();
  await page.route("**/api/infographics", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  await page.goto("/inbox/");
  await expect(page.getByText("Inbox could not be loaded. Try again.", { exact: true })).toBeVisible();
});
