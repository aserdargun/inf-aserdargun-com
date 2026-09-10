import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "playwright/test";

const image = readFileSync("api/test/fixtures/valid-infographic.png");
const suggestion = {
  title: "Memory hierarchy",
  notes: "A concise explanation.",
  language: "en",
  category: "Systems",
  topics: ["memory", "architecture"],
  crop: null,
  rationale: "The diagram labels show a hierarchy.",
  confidence: 0.91,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockCatalog(page: Page) {
  await page.route("**/api/infographics", (route) => {
    if (route.request().method() === "POST") return json(route, { kind: "created", infographicId: "00000000-0000-4000-8000-000000000099", title: suggestion.title }, 201);
    return json(route, { infographics: [], categories: [], tags: [] });
  });
  await page.route("**/api/settings/stats", (route) => json(route, { total: 0, uncategorized: 0, library: 0, archive: 0, due: 0, reviewed: 0, seen: 0 }));
}

test("counts tags as one editable field in the AI suggestion banner", async ({ page }) => {
  await mockCatalog(page);
  await page.route("**/api/infographics/suggest-metadata", (route) => json(route, { suggestion }));
  await page.goto("/add/");

  await page.getByLabel("Choose infographic").setInputFiles({ name: "memory.png", mimeType: "image/png", buffer: image });

  await expect(page.getByText("AI suggested 4 fields", { exact: false })).toBeVisible();
});

test("an early Add waits for the existing AI request and saves once", async ({ page }) => {
  let releaseSuggestion!: () => void;
  const suggestionGate = new Promise<void>((resolve) => { releaseSuggestion = resolve; });
  let suggestionRequests = 0;
  let captureRequests = 0;
  await page.route("**/api/infographics**", (route) => {
    if (route.request().method() === "POST") {
      captureRequests += 1;
      return json(route, { kind: "created", infographicId: "00000000-0000-4000-8000-000000000099", title: suggestion.title }, 201);
    }
    return json(route, { infographics: [], categories: [], tags: [], page: 1, pageSize: 24, totalItems: 0, totalPages: 0 });
  });
  await page.route("**/api/infographics/suggest-metadata", async (route) => {
    suggestionRequests += 1;
    await suggestionGate;
    await json(route, { suggestion });
  });
  await page.route("**/api/settings/stats", (route) => json(route, { total: 0, uncategorized: 0, library: 0, archive: 0, due: 0, reviewed: 0, seen: 0 }));
  await page.goto("/add/");
  await page.getByLabel("Choose infographic").setInputFiles({ name: "memory.png", mimeType: "image/png", buffer: image });
  await expect(page.getByText("Reading the image and drafting metadata…", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  releaseSuggestion();

  await expect(page).toHaveURL(/\/library\/$/);
  expect(suggestionRequests).toBe(1);
  expect(captureRequests).toBe(1);
});

test("late AI preserves manual fields, includes the crop, and locks file selection during save", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let capturedBody = "";
  let suggestions = 0;
  const crop = { top: 0.1, left: 0.1, bottom: 0.9, right: 0.9 };
  await page.route("**/api/infographics**", (route) => {
    if (route.request().method() === "POST") {
      capturedBody = route.request().postDataBuffer()?.toString() ?? "";
      return json(route, { kind: "created", infographicId: "00000000-0000-4000-8000-000000000099" }, 201);
    }
    return json(route, { infographics: [], categories: [], tags: [], page: 1, pageSize: 24, totalItems: 0, totalPages: 0 });
  });
  await page.route("**/api/infographics/suggest-metadata", async (route) => {
    suggestions++;
    await gate;
    await json(route, { suggestion: { ...suggestion, crop } });
  });
  await page.goto("/add/");
  await page.getByLabel("Choose infographic").setInputFiles({ name: "original.png", mimeType: "image/png", buffer: image });
  await page.getByLabel("Title", { exact: true }).fill("My title");
  await page.getByLabel("Category", { exact: true }).fill("My category");
  await page.getByLabel("Notes", { exact: true }).fill("My notes");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByLabel("Choose infographic")).toBeDisabled();
  await page.getByTestId("capture-dropzone").evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["replacement"], "replacement.png", { type: "image/png" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
  });
  await expect(page.locator(".capture-preview figcaption")).toHaveText("original.png");
  release();
  await expect(page).toHaveURL(/\/library\/$/);
  expect(suggestions).toBe(1);
  expect(capturedBody).toContain("My title");
  expect(capturedBody).toContain("My category");
  expect(capturedBody).toContain("My notes");
  const savedCrop = capturedBody.match(/name="crop"\r\n\r\n([^\r]+)/)?.[1];
  expect(JSON.parse(savedCrop ?? "null")).toEqual(crop);
  expect(capturedBody).not.toContain("replacement.png");
});

test("discarding suggestions preserves manually edited text", async ({ page }) => {
  await mockCatalog(page);
  await page.route("**/api/infographics/suggest-metadata", (route) => json(route, { suggestion }));
  await page.goto("/add/");
  await page.getByLabel("Choose infographic").setInputFiles({ name: "memory.png", mimeType: "image/png", buffer: image });
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(suggestion.title);
  await page.getByLabel("Title", { exact: true }).fill("Keep this title");
  await page.getByRole("button", { name: "Discard AI suggestions" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Keep this title");
  await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("");
});
