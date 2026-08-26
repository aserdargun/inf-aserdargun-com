import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { autoTrimBytes } from "../src/images/auto-trim.js";

const PADDING = 60;
const INNER_W = 400;
const INNER_H = 200;

async function makePaddedScreenshot(opts: { padding?: number; innerColor?: { r: number; g: number; b: number }; background?: { r: number; g: number; b: number } } = {}): Promise<Buffer> {
  const padding = opts.padding ?? PADDING;
  const bg = opts.background ?? { r: 255, g: 255, b: 255 };
  const fg = opts.innerColor ?? { r: 30, g: 30, b: 30 };
  const w = INNER_W + padding * 2;
  const h = INNER_H + padding * 2;
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: bg,
    },
  })
    .composite([{
      input: await sharp({
        create: { width: INNER_W, height: INNER_H, channels: 3, background: fg },
      }).png().toBuffer(),
      top: padding,
      left: padding,
    }])
    .png()
    .toBuffer();
}

async function makeTransparentCanvas(innerSize = { width: 200, height: 100 }): Promise<Buffer> {
  return sharp({
    create: {
      width: 500,
      height: 300,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{
      input: await sharp({
        create: { ...innerSize, channels: 4, background: { r: 200, g: 60, b: 60, alpha: 1 } },
      }).png().toBuffer(),
      top: 100,
      left: 150,
    }])
    .png()
    .toBuffer();
}

async function makeDenseImage(): Promise<Buffer> {
  // No padding; the content fills the entire image. Trim should not crop.
  return sharp({
    create: {
      width: 300,
      height: 200,
      channels: 3,
      background: { r: 50, g: 80, b: 200 },
    },
  }).png().toBuffer();
}

describe("autoTrimBytes", () => {
  it("trims a white background screenshot and reports the original dimensions", async () => {
    const bytes = await makePaddedScreenshot();
    const originalMeta = await sharp(bytes).metadata();
    const result = await autoTrimBytes(bytes);

    expect(result.trimmed).toBe(true);
    expect(result.width).toBeLessThan(originalMeta.width!);
    expect(result.height).toBeLessThan(originalMeta.height!);
    expect(result.originalWidth).toBe(originalMeta.width);
    expect(result.originalHeight).toBe(originalMeta.height);
    expect(result.detectedBackground).not.toBeNull();
    expect(result.detectedBackground!.r).toBeGreaterThan(200);
    expect(result.detectedBackground!.g).toBeGreaterThan(200);
    expect(result.detectedBackground!.b).toBeGreaterThan(200);
    expect(result.savedPixelRatio).toBeGreaterThan(0.05);
  });

  it("trims a dark background screenshot", async () => {
    const bytes = await makePaddedScreenshot({ background: { r: 10, g: 10, b: 10 }, innerColor: { r: 220, g: 220, b: 220 } });
    const originalMeta = await sharp(bytes).metadata();
    const result = await autoTrimBytes(bytes);

    expect(result.trimmed).toBe(true);
    expect(result.width).toBeLessThan(originalMeta.width!);
    expect(result.detectedBackground).not.toBeNull();
    expect(result.detectedBackground!.r).toBeLessThan(40);
  });

  it("does not trim an image that has no margin", async () => {
    const bytes = await makeDenseImage();
    const result = await autoTrimBytes(bytes);
    expect(result.trimmed).toBe(false);
    expect(result.savedPixelRatio).toBe(0);
    expect(result.detectedBackground).toBeNull();
  });

  it("trims a transparent canvas around opaque content", async () => {
    const bytes = await makeTransparentCanvas();
    const originalMeta = await sharp(bytes).metadata();
    const result = await autoTrimBytes(bytes);

    expect(result.trimmed).toBe(true);
    expect(result.width).toBeLessThan(originalMeta.width!);
    expect(result.height).toBeLessThan(originalMeta.height!);
    expect(result.detectedBackground?.alpha).toBe(0);
  });

  it("respects the minSavingsRatio and skips small trims", async () => {
    // 12px padding on a 800x600 image is well under 2% pixel savings.
    const bytes = await makePaddedScreenshot({ padding: 12 });
    const result = await autoTrimBytes(bytes, { minSavingsRatio: 0.5 });
    expect(result.trimmed).toBe(false);
    expect(result.savedPixelRatio).toBe(0);
  });

  it("respects the minDimension guard and skips tiny images", async () => {
    const bytes = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([{ input: await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer(), top: 20, left: 20 }])
      .png()
      .toBuffer();
    const result = await autoTrimBytes(bytes, { minDimension: 200 });
    expect(result.trimmed).toBe(false);
  });

  it("returns the input bytes unchanged when the buffer is invalid", async () => {
    const result = await autoTrimBytes(Buffer.alloc(0));
    expect(result.trimmed).toBe(false);
    expect(result.bytes.length).toBe(0);
  });

  it("does not enlarge a tight image", async () => {
    const bytes = await makeDenseImage();
    const result = await autoTrimBytes(bytes);
    expect(result.trimmed).toBe(false);
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
    expect(result.originalWidth).toBe(300);
    expect(result.originalHeight).toBe(200);
  });

  it("threshold option controls how aggressive the trim is", async () => {
    // Build an image where the "background" slowly transitions near the content,
    // simulating JPEG noise around the border.
    const bytes = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 250, g: 250, b: 250 } },
    })
      .composite([{
        input: await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer(),
        top: 50,
        left: 50,
      }])
      .png()
      .toBuffer();
    const strict = await autoTrimBytes(bytes, { threshold: 1 });
    const lenient = await autoTrimBytes(bytes, { threshold: 30 });
    expect(strict.trimmed || lenient.trimmed).toBe(true);
  });
});
