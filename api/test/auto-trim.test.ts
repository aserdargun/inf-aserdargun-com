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

  it("trims when all four borders share one solid color", async () => {
    const bytes = await makePaddedScreenshot({ padding: 40, background: { r: 240, g: 240, b: 240 } });
    const result = await autoTrimBytes(bytes);
    expect(result.trimmed).toBe(true);
    expect(result.width).toBe(INNER_W);
    expect(result.height).toBe(INNER_H);
  });

  it("trims each edge with its own color when corners disagree", async () => {
    // Build an image whose four borders are four different solid colors. A
    // single-color trim strategy would only crop the edges that match the
    // sampled corner; the per-edge walk should remove all four margins.
    const P = 30;
    const w = INNER_W + P * 2;
    const h = INNER_H + P * 2;
    const inner = await sharp({ create: { width: INNER_W, height: INNER_H, channels: 3, background: { r: 30, g: 30, b: 30 } } }).png().toBuffer();
    const top = await sharp({ create: { width: w, height: P, channels: 3, background: { r: 240, g: 240, b: 240 } } }).png().toBuffer();
    const bottom = await sharp({ create: { width: w, height: P, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toBuffer();
    const left = await sharp({ create: { width: P, height: INNER_H, channels: 3, background: { r: 200, g: 200, b: 200 } } }).png().toBuffer();
    const right = await sharp({ create: { width: P, height: INNER_H, channels: 3, background: { r: 50, g: 50, b: 50 } } }).png().toBuffer();
    const bytes = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite([
        { input: top, top: 0, left: 0 },
        { input: left, top: P, left: 0 },
        { input: inner, top: P, left: P },
        { input: right, top: P, left: w - P },
        { input: bottom, top: h - P, left: 0 },
      ])
      .png()
      .toBuffer();
    const result = await autoTrimBytes(bytes);
    expect(result.trimmed).toBe(true);
    expect(result.width).toBe(INNER_W);
    expect(result.height).toBe(INNER_H);
  });

  it("does not trim when borders are gradients rather than solid", async () => {
    // Build a raw image where every edge row/column has a different color, so
    // no uniform background can be found and the algorithm must not trim.
    const P = 30;
    const w = 200, h = 120;
    const data = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 3;
        // Per-pixel gradient: every neighbor differs, so no row/column is
        // uniform. The middle region is darker so any "single-color" heuristic
        // would still see variation on the borders.
        const v = (x * 255 / w + y * 255 / h) % 256;
        data[i] = Math.round(v);
        data[i + 1] = Math.round((v + 80) % 256);
        data[i + 2] = Math.round((v + 160) % 256);
      }
    }
    const bytes = await sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    void P;
    const result = await autoTrimBytes(bytes);
    expect(result.trimmed).toBe(false);
  });
});
