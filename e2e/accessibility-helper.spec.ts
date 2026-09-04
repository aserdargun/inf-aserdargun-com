import { expect, test } from "playwright/test";
import { expectFocusAboveBottomNavigation, expectViewportAccessibility } from "./support/accessibility";

test("rejects an interactive target that mutates to 10 by 44 pixels", async ({ page }) => {
  await page.setContent('<button style="width:10px;height:44px;padding:0">Narrow primary action</button>');

  await expect(expectViewportAccessibility(page)).rejects.toThrow();
});

test("rejects a bottom-navigation target that cannot receive focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(`
    <button disabled style="width:120px;height:44px">Disabled primary action</button>
    <nav class="mobile-nav" style="position:fixed;inset:auto 0 0;height:64px">Navigation</nav>
  `);

  await expect(expectFocusAboveBottomNavigation(page, page.getByRole("button"))).rejects.toThrow();
});

test("rejects a focused target outside the mobile 200 percent visual viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await page.setContent(`
    <button style="position:fixed;left:220px;top:96px;width:44px;height:44px;padding:0">Outside visual viewport</button>
    <nav class="mobile-nav" style="position:fixed;inset:auto 0 0;height:64px">Navigation</nav>
  `);

  await expect.poll(() => page.evaluate(() => ({
    innerWidth: window.innerWidth,
    visualWidth: window.visualViewport?.width,
    scale: window.visualViewport?.scale,
  }))).toEqual({ innerWidth: 390, visualWidth: 195, scale: 2 });
  await page.evaluate(() => Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: { height: 422, offsetLeft: 0, offsetTop: 0, scale: 2, width: 195 },
  }));

  await expect(expectFocusAboveBottomNavigation(page, page.getByRole("button"))).rejects.toThrow();
});

test("rejects a focused target obscured by the stuck owner top bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(`
    <header class="mobile-topbar" style="position:fixed;inset:0 0 auto;height:56px">Infographics</header>
    <button style="position:fixed;left:20px;top:12px;width:160px;height:44px;padding:0">Obscured action</button>
    <nav class="mobile-nav" style="position:fixed;inset:auto 0 0;height:64px">Navigation</nav>
  `);

  await expect(expectFocusAboveBottomNavigation(page, page.getByRole("button"))).rejects.toThrow();
});
