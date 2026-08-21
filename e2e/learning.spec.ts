import { expect, test } from "playwright/test";

const item = {
  id: "00000000-0000-4000-8000-000000000012", title: "Reviewable diagram", notes: null, sourceUrl: null, sourcePlatform: null, sourceAuthor: null,
  originalDriveFileId: "original", thumbnailDriveFileId: "thumbnail", sha256: "a".repeat(64), detectedMimeType: "image/png", width: 1200, height: 900,
  favorite: false, archived: false, createdAt: "2026-08-20T10:00:00.000Z", capturedAt: "2026-08-20T10:00:00.000Z", processedAt: null, lastSeenAt: null,
  seenCount: 0, categoryIds: [], tagIds: [], folderState: "Library", reviewCount: 0, lastReviewedAt: null, reviewDueAt: "2026-08-20T10:00:00.000Z",
};

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Jg1cAAAAASUVORK5CYII=", "base64");

test("surprise makes one persisted selection per intent and ignores stale responses", async ({ page }) => {
  let surpriseCalls = 0;
  let held: import("playwright/test").Route | undefined;
  await page.route("**/api/surprise", async (route) => {
    surpriseCalls += 1;
    if (surpriseCalls === 2) { held = route; return; }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographic: item }) });
  });
  await page.route("**/api/public/images/**", (route) => route.fulfill({ contentType: "image/png", body: png }));
  await page.goto("/surprise/");
  await expect(page.getByRole("img", { name: "Reviewable diagram" })).toBeVisible();
  await page.screenshot({ fullPage: true, path: ".superpowers/sdd/2026-08-20-inf-mvp-implementation/task-12-surprise-desktop.png" });
  expect(surpriseCalls).toBe(1);
  await page.getByRole("button", { name: "Show another" }).click();
  await expect.poll(() => held !== undefined).toBeTruthy();
  await expect(page.getByRole("button", { name: "Show another" })).toBeDisabled();
  expect(surpriseCalls).toBe(2);
  await held!.fulfill({ contentType: "application/json", body: JSON.stringify({ infographic: { ...item, title: "Second diagram" } }) });
  await expect(page.getByRole("img", { name: "Second diagram" })).toBeVisible();
  expect(surpriseCalls).toBe(2);
});

test("reviews persist before advancing, supports shortcuts, and handles empty and errors", async ({ page }) => {
  let dueCalls = 0;
  let reviewCalls = 0;
  let releaseReview: (() => void) | undefined;
  await page.route("**/api/review", async (route) => {
    dueCalls += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: dueCalls === 1 ? [item] : [] }) });
  });
  await page.route(`**/api/infographics/${item.id}/reviews`, async (route) => {
    reviewCalls += 1;
    await new Promise<void>((resolve) => { releaseReview = resolve; });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000013", infographicId: item.id, rating: "good", reviewedAt: "2026-08-21T10:00:00.000Z", previousIntervalDays: null, intervalDays: 7, dueAt: "2026-08-28T10:00:00.000Z" }) });
  });
  await page.route("**/api/public/images/**", (route) => route.fulfill({ contentType: "image/png", body: png }));
  await page.goto("/review/");
  await expect(page.getByRole("heading", { name: "Next review" })).toBeVisible();
  await page.keyboard.press("3");
  await expect(page.getByText("Saving review…", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Good/ })).toBeDisabled();
  await page.keyboard.press("3");
  expect(reviewCalls).toBe(1);
  releaseReview!();
  await expect(page.getByText("Review saved.", { exact: true })).toBeVisible();
  await expect(page.getByText("You are caught up.", { exact: true })).toBeVisible();
  await page.screenshot({ fullPage: true, path: ".superpowers/sdd/2026-08-20-inf-mvp-implementation/task-12-review-desktop.png" });
  expect(dueCalls).toBe(2);
  await page.reload();
  await expect(page.getByText("You are caught up.", { exact: true })).toBeVisible();
});

test("downloads a safe deterministic inventory and keeps Settings operational on desktop and mobile", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  const health = {
    schemaVersion: 1, application: { name: "INF", version: "0.1.0", runtimeVersion: "v22.0.0", usesAi: false },
    connectionHealth: { publicDrive: { rootId: "public", folderUrl: "https://drive.google.com/drive/folders/public", healthy: true, folders: [{ id: "inbox", label: "Inbox", healthy: true }] }, privateDrive: { rootId: "private", folderUrl: "https://drive.google.com/drive/folders/private", healthy: true, folders: [{ id: "events", label: "Events", healthy: true }] } },
    data: { total: 1, inbox: 0, library: 1, archive: 0, due: 0, reviewed: 0, seen: 1 },
    quarantine: { count: 0, reasons: [], rejectedFiles: [] },
    recovery: { inventorySchemaVersion: 1, items: [{ id: item.id, title: item.title, originalDriveFileId: "original", thumbnailDriveFileId: "thumbnail", sha256: "a".repeat(64), detectedMimeType: "image/png", width: 1200, height: 900, folderState: "Library", createdAt: item.createdAt, capturedAt: item.capturedAt, processedAt: null, lastSeenAt: null }] },
  };
  await page.route("**/api/settings/health", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(health) }));
  await page.goto("/settings/");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("INF does not use AI.", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export inventory JSON" }).click();
  const file = await download;
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(exported.schemaVersion).toBe(1);
  expect(exported.items).toHaveLength(1);
  expect(JSON.stringify(exported)).not.toMatch(/token|secret|email|credential/i);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBeTruthy();
  await page.screenshot({ fullPage: true, path: ".superpowers/sdd/2026-08-20-inf-mvp-implementation/task-12-settings-mobile.png" });
  expect(consoleErrors).toEqual([]);
});
