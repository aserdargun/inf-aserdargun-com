import { expect, test } from "playwright/test";
import { expectFocusAboveBottomNavigation, expectViewportAccessibility } from "./support/accessibility";

const item = {
  id: "00000000-0000-4000-8000-000000000012", title: "Reviewable diagram", notes: null,  originalDriveFileId: "original", thumbnailDriveFileId: "thumbnail", sha256: "a".repeat(64), detectedMimeType: "image/png", width: 1200, height: 900,
  favorite: false, archived: false, createdAt: "2026-08-20T10:00:00.000Z", capturedAt: "2026-08-20T10:00:00.000Z", processedAt: null, lastSeenAt: null,
  seenCount: 0, categoryIds: [], tagIds: [], folderState: "Library", reviewCount: 0, lastReviewedAt: null, reviewDueAt: "2026-08-20T10:00:00.000Z",
};

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Jg1cAAAAASUVORK5CYII=", "base64");

test("surprise makes one persisted selection per intent without seen posts or rerender duplicates", async ({ page }) => {
  let surpriseCalls = 0;
  let seenPosts = 0;
  const heldRoutes = new Map<number, import("playwright/test").Route>();
  await page.route("**/api/surprise", async (route) => {
    surpriseCalls += 1;
    if (surpriseCalls === 2 || surpriseCalls === 4) { heldRoutes.set(surpriseCalls, route); return; }
    const title = surpriseCalls === 3 ? "Third diagram" : surpriseCalls === 5 ? "Fresh diagram" : "Reviewable diagram";
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographic: { ...item, title } }) });
  });
  await page.route("**/api/infographics/**/seen", (route) => { seenPosts += 1; return route.fulfill({ status: 204 }); });
  await page.route("**/api/public/images/**", (route) => route.fulfill({ contentType: "image/png", body: png }));
  await page.goto("/surprise/");
  await expect(page.getByRole("img", { name: "Reviewable diagram" })).toBeVisible();
  await expect(page.locator(".surprise-page .learning-stage")).toBeVisible();
  await expect(page.locator(".surprise-page .media-canvas--learning")).toBeVisible();
  await expect(page.getByRole("img", { name: "Reviewable diagram" })).toHaveCSS("object-fit", "contain");
  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await expectViewportAccessibility(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFocusAboveBottomNavigation(page, page.getByRole("button", { name: "Show another" }));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ fullPage: true, path: ".superpowers/sdd/2026-08-20-inf-mvp-implementation/task-12-surprise-desktop.png" });
  expect(surpriseCalls).toBe(1);
  await page.getByRole("button", { name: "Switch to dark theme" }).dispatchEvent("click");
  await page.getByRole("img", { name: "Reviewable diagram" }).evaluate((image) => image.dispatchEvent(new Event("load")));
  expect(surpriseCalls).toBe(1);
  expect(seenPosts).toBe(0);
  await page.getByRole("button", { name: "Show another" }).click();
  await expect.poll(() => heldRoutes.has(2)).toBe(true);
  await expect(page.getByRole("button", { name: "Show another" })).toBeDisabled();
  expect(surpriseCalls).toBe(2);
  await heldRoutes.get(2)!.fulfill({ contentType: "application/json", body: JSON.stringify({ infographic: { ...item, title: "Second diagram" } }) });
  await expect(page.getByRole("img", { name: "Second diagram" })).toBeVisible();
  await page.getByRole("button", { name: "Switch to light theme" }).dispatchEvent("click");
  await page.getByRole("img", { name: "Second diagram" }).evaluate((image) => image.dispatchEvent(new Event("load")));
  expect(surpriseCalls).toBe(2);
  await page.getByRole("button", { name: "Show another" }).click();
  await expect(page.getByRole("img", { name: "Third diagram" })).toBeVisible();
  expect(surpriseCalls).toBe(3);
  await page.getByRole("button", { name: "Show another" }).click();
  await expect.poll(() => heldRoutes.has(4)).toBe(true);
  const staleHeld = heldRoutes.get(4)!;
  await page.goto("/settings/");
  await page.goto("/surprise/");
  await expect(page.getByRole("img", { name: "Fresh diagram" })).toBeVisible();
  await staleHeld.fulfill({ contentType: "application/json", body: JSON.stringify({ infographic: { ...item, title: "Stale diagram" } }) });
  await expect(page.getByRole("img", { name: "Fresh diagram" })).toBeVisible();
  expect(seenPosts).toBe(0);
});

test("reviews persist before advancing, supports shortcuts, and handles empty and errors", async ({ page }) => {
  let dueCalls = 0;
  let reviewCalls = 0;
  let releaseReview: (() => void) | undefined;
  const persisted: Array<{ id: string; rating: string }> = [];
  await page.route("**/api/review", async (route) => {
    dueCalls += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: dueCalls === 1 ? [item] : [] }) });
  });
  await page.route(`**/api/infographics/${item.id}/reviews`, async (route) => {
    reviewCalls += 1;
    const request = route.request();
    persisted.push({ id: new URL(request.url()).pathname.split("/")[3], rating: JSON.parse(request.postData() ?? "{}").rating });
    await new Promise<void>((resolve) => { releaseReview = resolve; });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000013", infographicId: item.id, rating: persisted[0]?.rating, reviewedAt: "2026-08-21T10:00:00.000Z", previousIntervalDays: null, intervalDays: 7, dueAt: "2026-08-28T10:00:00.000Z" }) });
  });
  await page.route("**/api/public/images/**", (route) => route.fulfill({ contentType: "image/png", body: png }));
  await page.goto("/review/");
  await expect(page.getByRole("heading", { name: "Next review" })).toBeVisible();
  await expect(page.locator(".review-page .learning-stage")).toBeVisible();
  await expect(page.locator(".review-page .media-canvas--learning")).toBeVisible();
  await expect(page.getByRole("img", { name: "Reviewable diagram" })).toHaveCSS("object-fit", "contain");
  await expect(page.locator(".rating-controls")).toHaveAttribute("data-equal-targets", "true");
  await expect(page.getByRole("button", { name: /Again/ })).toHaveAttribute("data-rating", "again");
  await expect(page.getByRole("button", { name: /Good/ })).toHaveAttribute("data-rating", "good");
  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await expectViewportAccessibility(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFocusAboveBottomNavigation(page, page.getByRole("button", { name: /Good/ }));
  await page.setViewportSize({ width: 1280, height: 720 });
  const ratingControls = page.locator(".rating-controls");
  const ratingButtons = ratingControls.locator(":scope > .button");
  await expect.poll(() => ratingControls.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(/\s+/).length)).toBe(4);
  const desktopTargets = await ratingButtons.evaluateAll((buttons) => buttons.map((button) => {
    const bounds = button.getBoundingClientRect();
    return { height: Math.round(bounds.height), width: Math.round(bounds.width) };
  }));
  expect(new Set(desktopTargets.map(({ width }) => width)).size).toBe(1);
  expect(new Set(desktopTargets.map(({ height }) => height)).size).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => ratingControls.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(/\s+/).length)).toBe(2);
  const mobileTargets = await ratingButtons.evaluateAll((buttons) => buttons.map((button) => {
    const bounds = button.getBoundingClientRect();
    return { height: Math.round(bounds.height), width: Math.round(bounds.width), x: Math.round(bounds.x), y: Math.round(bounds.y) };
  }));
  expect(new Set(mobileTargets.map(({ width }) => width)).size).toBe(1);
  expect(new Set(mobileTargets.map(({ height }) => height)).size).toBe(1);
  expect(mobileTargets[0]?.y).toBe(mobileTargets[1]?.y);
  expect(mobileTargets[2]?.y).toBe(mobileTargets[3]?.y);
  expect(mobileTargets[2]?.y).toBeGreaterThan(mobileTargets[0]?.y ?? 0);
  expect(mobileTargets[0]?.x).toBe(mobileTargets[2]?.x);
  expect(mobileTargets[1]?.x).toBe(mobileTargets[3]?.x);
  await page.setViewportSize({ width: 1280, height: 720 });
  const goodButton = page.getByRole("button", { name: /Good/ });
  await goodButton.click();
  await expect.poll(() => reviewCalls).toBe(1);
  await expect(page.getByText("Saving review…", { exact: true })).toBeVisible();
  await expect(goodButton).toBeDisabled();
  await page.keyboard.press("3");
  expect(reviewCalls).toBe(1);
  expect(persisted).toEqual([{ id: item.id, rating: "good" }]);
  expect(dueCalls).toBe(1);
  await expect(page.getByRole("heading", { name: "Next review" })).toBeVisible();
  releaseReview!();
  const saved = page.getByText("Review saved.", { exact: true });
  await expect(saved).toBeVisible();
  await expect(saved).toHaveCSS("color", "rgb(22, 128, 106)");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(saved).toHaveCSS("color", "rgb(103, 203, 179)");
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
    schemaVersion: 1, application: { name: "Infographics", version: "0.1.0", runtimeVersion: "v22.0.0", usesAi: false },
    connectionHealth: { publicDrive: { rootId: "public", folderUrl: "https://drive.google.com/drive/folders/public", healthy: true, folders: [{ id: "library", label: "Library", healthy: true }] }, privateDrive: { rootId: "private", folderUrl: "https://drive.google.com/drive/folders/private", healthy: true, folders: [{ id: "events", label: "Events", healthy: true }] } },
    data: { total: 1, uncategorized: 0, library: 1, archive: 0, due: 0, reviewed: 0, seen: 1 },
    quarantine: { count: 2, reasons: [{ reason: "invalid-event", count: 1 }, { reason: "unsupported-image", count: 1 }], rejectedFiles: [
      { eventId: "00000000-0000-4000-8000-000000000024", occurredAt: "2026-08-21T10:00:00.000Z", driveFileId: "newer-file", fileName: "newer.png", reason: "unsupported-image", detectedMimeType: "image/png" },
      { eventId: "00000000-0000-4000-8000-000000000023", occurredAt: "2026-08-20T10:00:00.000Z", driveFileId: "older-file", fileName: "older.webp", reason: "invalid-event", detectedMimeType: "image/webp" },
    ] },
    recovery: { inventorySchemaVersion: 1, items: [{ id: item.id, title: item.title, originalDriveFileId: "original", thumbnailDriveFileId: "thumbnail", sha256: "a".repeat(64), detectedMimeType: "image/png", width: 1200, height: 900, folderState: "Library", createdAt: item.createdAt, capturedAt: item.capturedAt, processedAt: null, lastSeenAt: null }] },
  };
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL); const revoke = URL.revokeObjectURL.bind(URL);
    Object.assign(globalThis, { __infExportMimes: [] as string[], __infRevokedUrls: [] as string[] });
    URL.createObjectURL = ((blob: Blob) => { (globalThis as unknown as { __infExportMimes: string[] }).__infExportMimes.push(blob.type); return create(blob); }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((url: string) => { (globalThis as unknown as { __infRevokedUrls: string[] }).__infRevokedUrls.push(url); revoke(url); }) as typeof URL.revokeObjectURL;
  });
  await page.route("**/api/settings/health", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...health, rawMalformedBody: "refresh_token=do-not-render" }) }));
  await page.goto("/settings/");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const headings = await page.locator(".settings-page h2").allTextContents();
  expect(headings.slice(0, 5)).toEqual(["Appearance", "Connection health", "Data health", "Backup and recovery", "Application details"]);
  await expect(page.locator(".status-value--positive").first()).toContainText("Healthy");
  await expect(page.getByRole("region", { name: "Appearance" }).getByRole("button", { name: /Switch to dark theme|Switch to light theme/ })).toBeVisible();
  await expect(page.locator(".settings-overview")).toBeVisible();
  const healthy = page.locator(".status-value--positive strong");
  await expect(healthy.first()).toHaveCSS("color", "rgb(22, 128, 106)");
  await expect(page.getByRole("region", { name: "Public Drive" }).locator(".status-value--positive strong").first()).toHaveCSS("color", "rgb(22, 128, 106)");
  await expect(page.getByRole("region", { name: "Data health" }).locator(".status-value--negative strong")).toHaveCSS("color", "rgb(178, 58, 58)");
  await page.getByRole("region", { name: "Appearance" }).getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(healthy.first()).toHaveCSS("color", "rgb(103, 203, 179)");
  await expect(page.getByText("AI suggestions are not configured.", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Data health" }).getByText("Uncategorized", { exact: true })).toBeVisible();
  const rejectedFiles = page.getByRole("list", { name: "Rejected files" });
  await expect(rejectedFiles).toHaveAccessibleName("Rejected files");
  await expect(rejectedFiles.getByRole("listitem")).toHaveCount(2);
  const rejectedText = await rejectedFiles.getByRole("listitem").allTextContents();
  expect(rejectedText[0]).toContain("older.webp");
  expect(rejectedText[0]).toContain("invalid-event");
  expect(rejectedText[0]).toContain("image/webp");
  expect(rejectedText[0]).toContain("older-file");
  expect(rejectedText[1]).toContain("newer.png");
  expect(rejectedText[1]).toContain("unsupported-image");
  expect(rejectedText[1]).toContain("image/png");
  expect(rejectedText[1]).toContain("newer-file");
  await expect(page.getByText("refresh_token=do-not-render", { exact: true })).toHaveCount(0);
  const button = page.getByRole("button", { name: "Export inventory JSON" });
  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await expectViewportAccessibility(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFocusAboveBottomNavigation(page, button);
  let downloadCount = 0;
  page.on("download", () => { downloadCount += 1; });
  const download = page.waitForEvent("download");
  const disabledDuringInitiation = await button.evaluate(async (node) => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    return (node as HTMLButtonElement).disabled;
  });
  expect(disabledDuringInitiation).toBe(true);
  const file = await download;
  expect(file.suggestedFilename()).toBe("inf-inventory-v1.json");
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(exported.schemaVersion).toBe(1);
  expect(exported.items).toHaveLength(1);
  expect(JSON.stringify(exported)).not.toMatch(/token|secret|email|credential/i);
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as { __infExportMimes: string[] }).__infExportMimes)).toEqual(["application/json"]);
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as { __infRevokedUrls: string[] }).__infRevokedUrls.length)).toBe(1);
  await expect(button).toBeEnabled();
  expect(downloadCount).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBeTruthy();
  await page.screenshot({ fullPage: true, path: ".superpowers/sdd/2026-08-20-inf-mvp-implementation/task-12-settings-mobile.png" });
  expect(consoleErrors).toEqual([]);
});

test("review shortcuts preserve server order and ignore modifier, form, button, contenteditable, and dialog contexts", async ({ page }) => {
  const first = { ...item, id: "00000000-0000-4000-8000-000000000014", title: "First due" };
  const second = { ...item, id: "00000000-0000-4000-8000-000000000015", title: "Server first" };
  let calls = 0;
  let queueCalls = 0;
  await page.route("**/api/review", (route) => { queueCalls += 1; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: queueCalls === 1 ? [second, first] : [first] }) }); });
  await page.route(`**/api/infographics/${second.id}/reviews`, (route) => { calls += 1; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000016", infographicId: second.id, rating: "good", reviewedAt: "2026-08-21T10:00:00.000Z", previousIntervalDays: null, intervalDays: 7, dueAt: "2026-08-28T10:00:00.000Z" }) }); });
  await page.route("**/api/public/images/**", (route) => route.fulfill({ contentType: "image/png", body: png }));
  await page.goto("/review/");
  await expect(page.getByRole("heading", { name: "Server first" })).toBeVisible();
  await page.keyboard.press("Meta+3"); await page.keyboard.press("Control+3"); await page.keyboard.press("Alt+3"); await page.keyboard.press("Shift+3");
  await page.getByRole("button", { name: /Good/ }).focus(); await page.keyboard.press("3");
  await page.evaluate(() => { const input = document.createElement("input"); input.setAttribute("aria-label", "suppression input"); document.body.append(input); input.focus(); });
  await page.keyboard.press("3");
  await page.evaluate(() => { const select = document.createElement("select"); select.setAttribute("aria-label", "suppression select"); select.append(new Option("One")); document.body.append(select); select.focus(); });
  await page.keyboard.press("3");
  await page.evaluate(() => { const textarea = document.createElement("textarea"); textarea.setAttribute("aria-label", "suppression textarea"); document.body.append(textarea); textarea.focus(); });
  await page.keyboard.press("3");
  await page.evaluate(() => { const edit = document.createElement("div"); edit.contentEditable = "true"; edit.textContent = "editable"; document.body.append(edit); edit.focus(); });
  await page.keyboard.press("3");
  await page.evaluate(() => { const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog"); dialog.tabIndex = 0; document.body.append(dialog); dialog.focus(); });
  await page.keyboard.press("3");
  expect(calls).toBe(0);
  await page.evaluate(() => { document.querySelector("[role='dialog']")?.remove(); (document.activeElement as HTMLElement)?.blur(); });
  await page.keyboard.press("3");
  await expect.poll(() => calls).toBe(1);
  await expect(page.getByRole("heading", { name: "First due" })).toBeVisible();
});

test("review shortcuts 1, 2, and 4 persist their mapped ratings before advancing", async ({ page }) => {
  const again = { ...item, id: "00000000-0000-4000-8000-000000000031", title: "Again due" };
  const hard = { ...item, id: "00000000-0000-4000-8000-000000000032", title: "Hard due" };
  const easy = { ...item, id: "00000000-0000-4000-8000-000000000033", title: "Easy due" };
  const due = [again, hard, easy];
  let queueCalls = 0;
  const persisted: Array<{ id: string; rating: string }> = [];
  await page.route("**/api/review", (route) => {
    const next = due[queueCalls++] ?? null;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: next ? [next] : [] }) });
  });
  await page.route("**/api/infographics/**/reviews", (route) => {
    const request = route.request();
    persisted.push({ id: new URL(request.url()).pathname.split("/")[3], rating: JSON.parse(request.postData() ?? "{}").rating });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: `00000000-0000-4000-8000-00000000004${persisted.length}`, infographicId: persisted.at(-1)?.id, rating: persisted.at(-1)?.rating, reviewedAt: "2026-08-21T10:00:00.000Z", previousIntervalDays: null, intervalDays: 7, dueAt: "2026-08-28T10:00:00.000Z" }) });
  });
  await page.route("**/api/public/images/**", (route) => route.fulfill({ contentType: "image/png", body: png }));
  await page.goto("/review/");
  await expect(page.getByRole("heading", { name: "Again due" })).toBeVisible();
  await page.keyboard.press("1");
  await expect(page.getByRole("heading", { name: "Hard due" })).toBeVisible();
  await page.keyboard.press("2");
  await expect(page.getByRole("heading", { name: "Easy due" })).toBeVisible();
  await page.keyboard.press("4");
  await expect(page.getByText("You are caught up.", { exact: true })).toBeVisible();
  expect(persisted).toEqual([
    { id: again.id, rating: "again" },
    { id: hard.id, rating: "hard" },
    { id: easy.id, rating: "easy" },
  ]);
});

test("review renders separate genuine load and save error states", async ({ page }) => {
  let queueCalls = 0;
  await page.route("**/api/review", (route) => { queueCalls += 1; return route.fulfill(queueCalls === 1 ? { status: 500, contentType: "application/json", body: "{}" } : { contentType: "application/json", body: JSON.stringify({ infographics: [item] }) }); });
  await page.route(`**/api/infographics/${item.id}/reviews`, (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  await page.route("**/api/public/images/**", (route) => route.fulfill({ contentType: "image/png", body: png }));
  await page.goto("/review/");
  await expect(page.getByText("The review could not be loaded. Try again.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Next review" })).toBeVisible();
  await page.getByRole("button", { name: /Good/ }).click();
  await expect(page.getByText("The review could not be saved. Try again.", { exact: true })).toBeVisible();
});

test("review keeps a confirmed save truthful when the next queue load fails", async ({ page }) => {
  let dueCalls = 0;
  await page.route("**/api/review", (route) => { dueCalls += 1; return route.fulfill(dueCalls === 1 ? { contentType: "application/json", body: JSON.stringify({ infographics: [item] }) } : { status: 500, contentType: "application/json", body: "{}" }); });
  await page.route(`**/api/infographics/${item.id}/reviews`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000017", infographicId: item.id, rating: "good", reviewedAt: "2026-08-21T10:00:00.000Z", previousIntervalDays: null, intervalDays: 7, dueAt: "2026-08-28T10:00:00.000Z" }) }));
  await page.route("**/api/public/images/**", (route) => route.fulfill({ contentType: "image/png", body: png }));
  await page.goto("/review/");
  await page.getByRole("button", { name: /Good/ }).click();
  await expect(page.getByText("Review saved.", { exact: true })).toBeVisible();
  await expect(page.getByText("The review could not be loaded. Try again.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Again|Hard|Good|Easy/ })).toHaveCount(0);
});

test("Settings surfaces safe export failures", async ({ page }) => {
  await page.addInitScript(() => { URL.createObjectURL = (() => { throw new Error("download unavailable"); }) as typeof URL.createObjectURL; });
  await page.route("**/api/settings/health", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, application: { name: "Infographics", version: "0.1.0", runtimeVersion: "v22.0.0", usesAi: false }, connectionHealth: { publicDrive: { rootId: "public", folderUrl: "https://drive.google.com/drive/folders/public", healthy: true, folders: [] }, privateDrive: { rootId: "private", folderUrl: "https://drive.google.com/drive/folders/private", healthy: true, folders: [] } }, data: { total: 0, uncategorized: 0, library: 0, archive: 0, due: 0, reviewed: 0, seen: 0 }, quarantine: { count: 0, reasons: [], rejectedFiles: [] }, recovery: { inventorySchemaVersion: 1, items: [] } }) }));
  await page.goto("/settings/");
  await page.getByRole("button", { name: "Export inventory JSON" }).click();
  await expect(page.getByText("The inventory could not be exported. Try again.", { exact: true })).toBeVisible();
});

test("bounds Settings loading and error states with a Settings icon", async ({ page }) => {
  await page.route("**/api/settings/health", () => new Promise(() => undefined));
  await page.goto("/settings/");
  await expect(page.getByText("Loading Settings…", { exact: true })).toBeVisible();
  await expect(page.locator(".page-state")).toHaveAttribute("data-layout", "compact");
  await expect(page.locator(".page-state svg.lucide-settings")).toHaveCount(1);

  await page.unrouteAll();
  await page.route("**/api/settings/health", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  await page.reload();
  await expect(page.getByText("Settings could not be loaded. Try again.", { exact: true })).toBeVisible();
  await expect(page.locator(".page-state")).toHaveAttribute("data-layout", "compact");
  await expect(page.locator(".page-state svg.lucide-settings")).toHaveCount(1);
});
