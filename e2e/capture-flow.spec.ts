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
