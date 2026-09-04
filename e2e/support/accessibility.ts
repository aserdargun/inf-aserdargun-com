import { expect, type Locator, type Page } from "playwright/test";

export async function expectViewportAccessibility(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const undersized = await page.locator("a,button,input,select,textarea").evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") return [];
    const effectiveTarget = element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)
      ? element.closest("label") ?? element
      : element;
    const box = effectiveTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0 || (box.width >= 44 && box.height >= 44)) return [];
    return [{ name: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName, width: box.width, height: box.height }];
  }));
  expect(undersized).toEqual([]);
}

export async function expectFocusAboveBottomNavigation(page: Page, target: Locator) {
  const navigation = page.locator(".mobile-nav");
  const topbar = page.locator(".mobile-topbar");
  const navigationVisible = await navigation.isVisible();
  const topbarVisible = await topbar.isVisible();
  if (!navigationVisible && !topbarVisible) return;
  await target.focus();
  await expect(target).toBeFocused();
  await target.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
  const geometry = await target.evaluate((element) => {
    const targetBox = element.getBoundingClientRect();
    const visual = window.visualViewport;
    const left = visual?.offsetLeft ?? 0;
    const top = visual?.offsetTop ?? 0;
    const width = visual?.width ?? window.innerWidth;
    const height = visual?.height ?? window.innerHeight;
    return {
      target: { bottom: targetBox.bottom, left: targetBox.left, right: targetBox.right, top: targetBox.top },
      viewport: { left, top, right: left + width, bottom: top + height },
    };
  });
  const navigationTop = navigationVisible ? await navigation.evaluate((element) => element.getBoundingClientRect().top) : geometry.viewport.bottom;
  const topbarBottom = topbarVisible ? await topbar.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const viewportTop = window.visualViewport?.offsetTop ?? 0;
    const position = getComputedStyle(element).position;
    return ["fixed", "sticky"].includes(position) && box.top <= viewportTop + 1 && box.bottom > viewportTop ? box.bottom : viewportTop;
  }) : geometry.viewport.top;
  expect(geometry.target.right).toBeGreaterThan(geometry.viewport.left);
  expect(geometry.target.left).toBeLessThan(geometry.viewport.right);
  expect(geometry.target.top).toBeGreaterThanOrEqual(Math.max(topbarBottom, geometry.viewport.top));
  expect(geometry.target.bottom).toBeLessThanOrEqual(Math.min(navigationTop, geometry.viewport.bottom));
}
