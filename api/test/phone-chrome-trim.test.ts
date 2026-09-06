import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { phoneChromeTrimBytes } from "../src/images/phone-chrome-trim.js";

async function makePhoneLikeScreenshot(opts: {
  width?: number;
  height?: number;
  statusBarHeight?: number;
  homeIndicatorHeight?: number;
  statusBarColor?: { r: number; g: number; b: number };
  contentColor?: { r: number; g: number; b: number };
  statusBarText?: boolean;
  homeBar?: boolean;
} = {}): Promise<Buffer> {
  const width = opts.width ?? 1170;
  const height = opts.height ?? 2532;
  const statusBarHeight = opts.statusBarHeight ?? 132;
  const homeIndicatorHeight = opts.homeIndicatorHeight ?? 280;
  const statusBarColor = opts.statusBarColor ?? { r: 28, g: 28, b: 30 };
  const contentColor = opts.contentColor ?? { r: 255, g: 255, b: 255 };
  const layers: Array<{ input: Buffer; top: number; left: number }> = [
    {
      input: await sharp({
        create: { width, height: statusBarHeight, channels: 4, background: { r: statusBarColor.r, g: statusBarColor.g, b: statusBarColor.b, alpha: 1 } },
      }).png().toBuffer(),
      top: 0,
      left: 0,
    },
    {
      input: await sharp({
        create: { width, height: homeIndicatorHeight, channels: 4, background: { r: statusBarColor.r, g: statusBarColor.g, b: statusBarColor.b, alpha: 1 } },
      }).png().toBuffer(),
      top: height - homeIndicatorHeight,
      left: 0,
    },
  ];
  if (opts.statusBarText) {
    const textSvg = `<svg width="${width}" height="${statusBarHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="rgb(${statusBarColor.r},${statusBarColor.g},${statusBarColor.b})"/>
      <text x="80" y="80" font-family="Arial" font-size="50" fill="white" font-weight="600">13:03</text>
      <circle cx="980" cy="68" r="5" fill="white"/>
      <circle cx="1000" cy="68" r="5" fill="white"/>
      <circle cx="1020" cy="68" r="5" fill="white"/>
      <rect x="1040" y="55" width="60" height="30" fill="none" stroke="white" stroke-width="2" rx="5"/>
      <rect x="1045" y="60" width="40" height="20" fill="rgb(105,205,75)"/>
    </svg>`;
    layers[0] = { input: await sharp(Buffer.from(textSvg)).png().toBuffer(), top: 0, left: 0 };
  }
  if (opts.homeBar) {
    const homeSvg = `<svg width="${width}" height="${homeIndicatorHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="rgb(${statusBarColor.r},${statusBarColor.g},${statusBarColor.b})"/>
      <rect x="${width / 2 - 60}" y="${homeIndicatorHeight - 30}" width="120" height="6" rx="3" fill="white"/>
    </svg>`;
    layers[1] = { input: await sharp(Buffer.from(homeSvg)).png().toBuffer(), top: height - homeIndicatorHeight, left: 0 };
  }
  return sharp({
    create: { width, height, channels: 4, background: { r: contentColor.r, g: contentColor.g, b: contentColor.b, alpha: 1 } },
  })
  .composite(layers)
  .png()
  .toBuffer();
}

async function makeLandscapeScreenshot(): Promise<Buffer> {
  return sharp({
    create: { width: 1280, height: 800, channels: 3, background: { r: 30, g: 30, b: 30 } },
  })
  .composite([{
    input: await sharp({
      create: { width: 1000, height: 600, channels: 3, background: { r: 220, g: 220, b: 220 } },
    }).png().toBuffer(),
    top: 100, left: 140,
  }])
  .png()
  .toBuffer();
}

describe("phoneChromeTrimBytes", () => {
  it("returns null for non-phone (landscape) aspect ratios", async () => {
    const bytes = await makeLandscapeScreenshot();
    const result = await phoneChromeTrimBytes(bytes);
    expect(result).toBeNull();
  });

  it("returns null for square-ish images", async () => {
    const bytes = await sharp({
      create: { width: 1000, height: 1000, channels: 4, background: { r: 28, g: 28, b: 30, alpha: 1 } },
    })
    .composite([{
      input: await sharp({
        create: { width: 600, height: 600, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
      }).png().toBuffer(),
      top: 200, left: 200,
    }])
    .png()
    .toBuffer();
    const result = await phoneChromeTrimBytes(bytes);
    expect(result).toBeNull();
  });

  it("uses the content transition row when the status bar ends in a clean light gap", async () => {
    // 1170x2532 phone screenshot. Status bar is 132px, then 70px white
    // gap, then light content. The transition walk finds the dark->light
    // boundary at y=132 and refines the hard cap (203px) down to 132px.
    const bytes = await makePhoneLikeScreenshot({ statusBarHeight: 132, homeIndicatorHeight: 280 });
    const meta = await sharp(bytes).metadata();
    const result = await phoneChromeTrimBytes(bytes);
    expect(result).not.toBeNull();
    // The transition walk finds the content start at the end of the status
    // bar, so the top crop is the actual status bar size, not the cap.
    expect(result!.top).toBe(132);
    // The home indicator is 280px tall, which is below the bottom hard
    // cap (380px), so the transition walk also wins on the bottom.
    expect(result!.bottom).toBe(280);
    expect(result!.width).toBe(meta.width);
    expect(result!.height).toBe((meta.height ?? 0) - result!.top - result!.bottom);
  });

  it("falls back to the hard cap when the status bar carries white text and battery icons", async () => {
    // Same shape as the previous test, but the status bar now has a
    // "13:03" label and a battery icon. The transition walk's edge color
    // sample is averaged over the first 12 rows, so the mean still tracks
    // the dark status bar background; the white pixels are sparse enough
    // that no row's mean distance clears the threshold within the
    // 2x-walk limit. The hard cap takes over and crops the full top 8%.
    const bytes = await makePhoneLikeScreenshot({ statusBarText: true, statusBarHeight: 132, homeIndicatorHeight: 280 });
    const meta = await sharp(bytes).metadata();
    const result = await phoneChromeTrimBytes(bytes);
    expect(result).not.toBeNull();
    expect(result!.top).toBe(132);
    expect(result!.bottom).toBe(280);
    expect(result!.width).toBe(meta.width);
    expect(result!.height).toBe((meta.height ?? 0) - result!.top - result!.bottom);
  });

  it("crops the home indicator area when a small white home bar sits inside it", async () => {
    // 1170x2532 phone screenshot whose home indicator area contains a
    // small 120x6 home indicator bar. The bar is too thin (6 rows) for
    // the per-row mean distance to clear the threshold, so the walk
    // skips past it and stops at the real light->dark transition where
    // the content meets the home indicator area.
    const bytes = await makePhoneLikeScreenshot({ homeBar: true, statusBarHeight: 132, homeIndicatorHeight: 280 });
    const meta = await sharp(bytes).metadata();
    const result = await phoneChromeTrimBytes(bytes);
    expect(result).not.toBeNull();
    expect(result!.top).toBe(132);
    expect(result!.bottom).toBe(280);
    expect(result!.width).toBe(meta.width);
    expect(result!.height).toBe((meta.height ?? 0) - result!.top - result!.bottom);
  });

  it("always crops the device bezel for a phone-aspect image even when no transition is found", async () => {
    // 1080x2340 image whose content fills the full height with a single
    // dark color. The transition walk finds no boundary, so the hard
    // cap (8% top, 15% bottom) drives the crop. This is the floor the
    // pass guarantees: a phone-aspect upload always loses the device
    // bezel's worth of chrome.
    const bytes = await sharp({
      create: { width: 1080, height: 2340, channels: 4, background: { r: 30, g: 40, b: 60, alpha: 1 } },
    }).png().toBuffer();
    const result = await phoneChromeTrimBytes(bytes);
    expect(result).not.toBeNull();
    expect(result!.top).toBe(Math.floor(2340 * 0.08));
    expect(result!.bottom).toBe(Math.floor(2340 * 0.15));
  });

  it("does not over-crop a dark hero panel: the hard cap is the upper bound", async () => {
    // 1170x2532 image: 150px status bar + 800px dark hero + light content
    // + 600px home indicator area. The transition walk never clears the
    // threshold within the 2x cap (the dark hero is too dark a match
    // for the status bar, and the bottom home indicator area is too dark
    // a match for itself). The hard cap is the floor and the cap: top
    // crop is 8% of 2532 (203px, well inside the 150px status bar + a
    // few px of hero), bottom crop is 15% of 2532 (380px, well inside
    // the 600px home indicator area). The dark hero and the dark home
    // indicator area are NOT consumed because the walk gave up.
    const width = 1170;
    const height = 2532;
    const statusBarHeight = 150;
    const darkHeroHeight = 800;
    const homeIndicatorArea = 600;
    const layers = [
      {
        input: await sharp({
          create: { width, height: statusBarHeight, channels: 4, background: { r: 28, g: 28, b: 30, alpha: 1 } },
        }).png().toBuffer(),
        top: 0, left: 0,
      },
      {
        input: await sharp({
          create: { width, height: darkHeroHeight, channels: 4, background: { r: 32, g: 32, b: 34, alpha: 1 } },
        }).png().toBuffer(),
        top: statusBarHeight, left: 0,
      },
      {
        input: await sharp({
          create: { width, height: homeIndicatorArea, channels: 4, background: { r: 28, g: 28, b: 30, alpha: 1 } },
        }).png().toBuffer(),
        top: height - homeIndicatorArea, left: 0,
      },
    ];
    const bytes = await sharp({
      create: { width, height, channels: 4, background: { r: 240, g: 240, b: 240, alpha: 1 } },
    })
    .composite(layers)
    .png()
    .toBuffer();
    const result = await phoneChromeTrimBytes(bytes);
    expect(result).not.toBeNull();
    expect(result!.top).toBe(Math.floor(height * 0.08));
    expect(result!.bottom).toBe(Math.floor(height * 0.15));
  });

  it("crops a 4000px-tall image within the absolute cap, not the fraction", async () => {
    // 1080x4000 image with a 200px status bar. 25% of 4000 is 1000px and
    // would let the walk run far past the chrome; the absolute hard cap
    // (8% of 4000 = 320px) and the 2x walk limit (640px) keep the crop
    // bounded so the dark hero that follows the status bar is safe.
    const bytes = await makePhoneLikeScreenshot({ height: 4000, statusBarHeight: 200, homeIndicatorHeight: 200 });
    const result = await phoneChromeTrimBytes(bytes);
    expect(result).not.toBeNull();
    expect(result!.top).toBeLessThanOrEqual(320);
    expect(result!.bottom).toBeLessThanOrEqual(600);
  });
});
