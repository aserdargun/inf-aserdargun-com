import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "playwright/test";

const image = readFileSync("api/test/fixtures/valid-infographic.png");
const ownerItem = {
  id: "00000000-0000-4000-8000-000000000201", title: "Systems thinking map", notes: null, sourceUrl: null, sourcePlatform: null, sourceAuthor: null,
  originalDriveFileId: "owner-original", thumbnailDriveFileId: "owner-thumbnail", sha256: "a".repeat(64), detectedMimeType: "image/png", width: 1200, height: 900,
  favorite: false, archived: false, createdAt: "2026-08-30T10:00:00.000Z", capturedAt: "2026-08-30T10:00:00.000Z", processedAt: null, lastSeenAt: null,
  seenCount: 0, categoryIds: [], tagIds: [], folderState: "Inbox", reviewCount: 0, lastReviewedAt: null, reviewDueAt: "2026-08-30T10:00:00.000Z",
};
const publicItem = {
  id: "00000000-0000-4000-8000-000000000202",
  title: "Systems thinking map",
  publishedAt: "2026-08-30T10:00:00.000Z",
  thumbnailUrl: "/api/public/images/public-thumbnail",
  imageUrl: "/api/public/images/public-original",
};

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function expectDecodedImage(image: Locator) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(async (element) => {
    if (!(element instanceof HTMLImageElement) || !element.complete || element.naturalWidth <= 0 || element.naturalHeight <= 0) return false;
    try {
      await element.decode();
    } catch {
      return false;
    }
    return element.complete && element.naturalWidth > 0 && element.naturalHeight > 0;
  })).toBe(true);
}

async function mockOwnerEvidence(page: Page) {
  await page.route("**/api/infographics", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ infographics: [ownerItem], categories: [], tags: [] }) }));
  await page.route("**/api/settings/stats", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ total: 1, inbox: 1, library: 0, archive: 0, due: 1, reviewed: 0, seen: 0 }) }));
  await page.route("**/api/public/images/**", (route) => route.fulfill({ body: image, contentType: "image/png" }));
}

async function mockPublicEvidence(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "serviceWorker", { configurable: true, value: undefined });
  });
  await page.route("**/api/public/infographics**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([publicItem]) }));
  await page.route("**/api/public/images/**", (route) => route.fulfill({ body: image, contentType: "image/png" }));
}

test("captures owner Evolutionary 2.0 evidence", async ({ page }) => {
  await mockOwnerEvidence(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expectDecodedImage(page.getByRole("img", { name: ownerItem.title }).first());
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "docs/design/evidence/owner-desktop.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/add/");
  await page.getByLabel("Choose infographic").setInputFiles({ name: "learning-loop.png", mimeType: "image/png", buffer: image });
  await expectDecodedImage(page.getByRole("img", { name: "Infographic preview" }));
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "docs/design/evidence/owner-mobile.png" });
});

test("captures public Evolutionary 2.0 evidence", async ({ page }) => {
  await mockPublicEvidence(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/view/");
  await expectDecodedImage(page.getByRole("img", { name: publicItem.title }));
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "docs/design/evidence/public-desktop.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expectDecodedImage(page.getByRole("img", { name: publicItem.title }));
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "docs/design/evidence/public-mobile.png" });
});
