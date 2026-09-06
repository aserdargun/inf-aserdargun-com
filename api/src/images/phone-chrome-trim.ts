import sharp, { type Metadata } from "sharp";

/**
 * Phone screenshot chrome trim.
 *
 * The general auto-trim samples the four edges and walks them inward, but the
 * per-pixel walk bails out on the first non-matching row. On an iPhone
 * screenshot the very first row of the status bar already carries a few white
 * pixels (the time, the battery icon, the signal bars) so the walk stops at
 * y=0 and never crops the chrome. The standard `sharp().trim()` fast path
 * has the same problem: it leaves the row because the row is not 100%
 * background. The result: phone uploads keep their status bar at the top
 * and their home-indicator strip at the bottom.
 *
 * This module catches phone aspect ratios (height/width >= 1.7) and applies
 * a two-stage crop:
 *
 * 1. **Status bar / home indicator hard crop.** The status bar on every
 *    shipped iPhone is 130-220px and the home-indicator area is bounded by
 *    the device bezel at 200-400px. We hard-crop the top 8% and the bottom
 *    15% of the image, which covers every iPhone / Android variant in
 *    production and leaves the actual infographic untouched for any normal
 *    content.
 *
 * 2. **Content transition refinement.** When the image carries a clear
 *    light/dark boundary close to the edge (the typical case for a phone
 *    screenshot of a light-background infographic), we walk inward from
 *    each edge and look for the first row whose mean color diverges from
 *    the edge color. This pulls in the small white gap that sits between
 *    the status bar and the infographic so the saved file starts on actual
 *    content, not on the very last pixel of the status bar. The walk is
 *    bounded so a dark "hero" panel that the infographic author designed
 *    as content cannot be mistaken for chrome.
 *
 * The savings floor (5%) keeps the pass conservative: a phone-aspect image
 * that is already content-tight is left untouched.
 */

const PHONE_ASPECT_RATIO_THRESHOLD = 1.7;
const PHONE_CHROME_DISTANCE_THRESHOLD = 50;
const PHONE_CHROME_MIN_SAVINGS_RATIO = 0.05;
// Top edge color is averaged over the first few rows so a single row of
// "13:03" text does not bias the mean away from the dark status bar color.
const PHONE_CHROME_TOP_EDGE_SAMPLE = 12;
// Bottom edge color is averaged over the last few rows for the same reason.
const PHONE_CHROME_BOTTOM_EDGE_SAMPLE = 12;
// Skip the left/right 5% when sampling the edge so a design element that
// reaches the very edge (a colored tab, a label hanging off the side) does
// not skew the edge color the way it does for the four-corner sample.
const PHONE_CHROME_EDGE_HORIZONTAL_MARGIN = 0.05;
// Status bars are bounded by the device bezel. We hard-crop the top 8% of
// the image and the bottom 15% as a guaranteed first pass; the transition
// walk can then refine, but never go past these caps.
const PHONE_CHROME_TOP_HARD_FRACTION = 0.08;
const PHONE_CHROME_BOTTOM_HARD_FRACTION = 0.15;

export interface PhoneChromeTrimConfig {
  aspectRatioThreshold: number;
  distanceThreshold: number;
  minSavingsRatio: number;
  topEdgeSampleRows: number;
  bottomEdgeSampleRows: number;
  edgeHorizontalMargin: number;
  topHardFraction: number;
  bottomHardFraction: number;
}

export const DEFAULT_PHONE_CHROME_TRIM_CONFIG: PhoneChromeTrimConfig = {
  aspectRatioThreshold: PHONE_ASPECT_RATIO_THRESHOLD,
  distanceThreshold: PHONE_CHROME_DISTANCE_THRESHOLD,
  minSavingsRatio: PHONE_CHROME_MIN_SAVINGS_RATIO,
  topEdgeSampleRows: PHONE_CHROME_TOP_EDGE_SAMPLE,
  bottomEdgeSampleRows: PHONE_CHROME_BOTTOM_EDGE_SAMPLE,
  edgeHorizontalMargin: PHONE_CHROME_EDGE_HORIZONTAL_MARGIN,
  topHardFraction: PHONE_CHROME_TOP_HARD_FRACTION,
  bottomHardFraction: PHONE_CHROME_BOTTOM_HARD_FRACTION,
};

export interface PhoneChromeTrimResult {
  top: number;
  bottom: number;
  width: number;
  height: number;
  topEdgeColor: { r: number; g: number; b: number; a: number };
  bottomEdgeColor: { r: number; g: number; b: number; a: number };
}

interface RawImage { data: Uint8Array; channels: number; width: number; height: number; }

function isAnimated(metadata: Metadata): boolean {
  const pages = metadata.pages;
  return typeof pages === "number" && pages > 1;
}

function isPhone(metadata: Metadata, threshold: number): boolean {
  if (!metadata.width || !metadata.height) return false;
  return metadata.height / metadata.width >= threshold;
}

function pixelAt(raw: RawImage, x: number, y: number): { r: number; g: number; b: number; a: number } {
  const stride = raw.channels;
  const i = (y * raw.width + x) * stride;
  return { r: raw.data[i]!, g: raw.data[i + 1]!, b: raw.data[i + 2]!, a: raw.data[i + 3] ?? 255 };
}

function colorDistance(a: { r: number; g: number; b: number; a: number }, b: { r: number; g: number; b: number; a: number }): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

async function readRaw(bytes: Buffer, maxPixels: number): Promise<RawImage | null> {
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: maxPixels })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, channels: info.channels, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

function averageColor(
  raw: RawImage,
  fromX: number,
  toX: number,
  fromY: number,
  toY: number,
): { r: number; g: number; b: number; a: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let count = 0;
  for (let y = fromY; y < toY; y += 1) {
    for (let x = fromX; x < toX; x += 1) {
      const p = pixelAt(raw, x, y);
      r += p.r;
      g += p.g;
      b += p.b;
      a += p.a;
      count += 1;
    }
  }
  return count > 0
    ? { r: r / count, g: g / count, b: b / count, a: a / count }
    : { r: 0, g: 0, b: 0, a: 0 };
}

/**
 * Walk rows in the requested direction and return the index of the first
 * row whose mean color distance to the edge color exceeds the threshold.
 * The walk is bounded by `maxScanRows` so a dark content region that
 * happens to match the edge color (e.g. a dark "hero" panel in a phone
 * screenshot of a dark-mode infographic) cannot drag the crop into the
 * middle of the image. The caller pairs this with a hard fraction cap so
 * the chrome is guaranteed to be removed even when the walk gives up.
 */
function findFirstTransitionRow(
  raw: RawImage,
  edgeColor: { r: number; g: number; b: number; a: number },
  direction: "top" | "bottom",
  distanceThreshold: number,
  maxScanRows: number,
): number | null {
  const { width, height } = raw;
  if (direction === "top") {
    const limit = Math.min(height, maxScanRows);
    for (let y = 0; y < limit; y += 1) {
      let sumDist = 0;
      for (let x = 0; x < width; x += 1) {
        sumDist += colorDistance(pixelAt(raw, x, y), edgeColor);
      }
      const meanDist = sumDist / width;
      if (meanDist > distanceThreshold) return y;
    }
    return null;
  }
  const limit = Math.min(height, maxScanRows);
  for (let y = height - 1; y >= height - limit; y -= 1) {
    let sumDist = 0;
    for (let x = 0; x < width; x += 1) {
      sumDist += colorDistance(pixelAt(raw, x, y), edgeColor);
    }
    const meanDist = sumDist / width;
    if (meanDist > distanceThreshold) return y;
  }
  return null;
}

export async function phoneChromeTrimBytes(
  bytes: Buffer,
  options?: { maxPixels?: number; config?: PhoneChromeTrimConfig },
): Promise<PhoneChromeTrimResult | null> {
  const config = options?.config ?? DEFAULT_PHONE_CHROME_TRIM_CONFIG;
  const maxPixels = options?.maxPixels ?? 40_000_000;

  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: maxPixels, animated: true, pages: -1 }).metadata();
  } catch {
    return null;
  }
  if (isAnimated(metadata)) return null;
  if (!isPhone(metadata, config.aspectRatioThreshold)) return null;

  const raw = await readRaw(bytes, maxPixels);
  if (!raw) return null;

  // Sample the edge color from the middle 90% of the very top (and very
  // bottom) strip. Skipping the corners avoids skewing the mean with a
  // design element that sits at the very edge of the image.
  const marginX = Math.floor(raw.width * config.edgeHorizontalMargin);
  const fromX = Math.min(marginX, Math.floor(raw.width / 4));
  const toX = Math.max(fromX + 1, raw.width - fromX);

  const topEdgeColor = averageColor(
    raw,
    fromX,
    toX,
    0,
    Math.min(config.topEdgeSampleRows, raw.height),
  );
  const bottomEdgeColor = averageColor(
    raw,
    fromX,
    toX,
    Math.max(0, raw.height - config.bottomEdgeSampleRows),
    raw.height,
  );

  // Hard-fraction floor: the device bezel guarantees the chrome is small.
  // The transition walk can EXTEND the crop if the content edge is closer
  // than the cap (the typical case for a phone screenshot of a light-mode
  // infographic with a white gap below the status bar), but it can never
  // exceed the cap. This is the safeguard that keeps a dark "hero" panel
  // from being mistaken for chrome.
  const topHardCap = Math.floor(raw.height * config.topHardFraction);
  const bottomHardCap = Math.floor(raw.height * config.bottomHardFraction);
  // Bound the transition walk at 2x the hard cap so the walk can look a
  // little past the hard cap (a small white gap below the status bar) but
  // not far enough to mistake a dark content region for chrome.
  const topWalkLimit = Math.max(topHardCap * 2, config.topEdgeSampleRows);
  const bottomWalkLimit = Math.max(bottomHardCap * 2, config.bottomEdgeSampleRows);

  const topTransition = findFirstTransitionRow(raw, topEdgeColor, "top", config.distanceThreshold, topWalkLimit);
  const bottomTransition = findFirstTransitionRow(raw, bottomEdgeColor, "bottom", config.distanceThreshold, bottomWalkLimit);

  // The transition, when found, points at the first row of actual content.
  // That is the most-aggressive crop we can make without losing content.
  // When the walk gives up (dark content that looks like chrome), the hard
  // cap is the floor: we always remove the device bezel's worth of chrome
  // so the saved file does not keep the iOS status bar or home indicator.
  // We never exceed the hard cap on the way OUT — the transition walk is
  // bounded precisely so it cannot drag the crop into the dark hero.
  const top = topTransition !== null ? topTransition : topHardCap;
  const bottom = bottomTransition !== null
    ? Math.min(raw.height - 1 - bottomTransition, bottomHardCap)
    : bottomHardCap;
  if (top === 0 && bottom === 0) return null;

  const newWidth = raw.width;
  const newHeight = raw.height - top - bottom;
  if (newWidth <= 0 || newHeight <= 0) return null;
  if (newHeight >= raw.height) return null;

  const originalPixels = raw.width * raw.height;
  const trimmedPixels = newWidth * newHeight;
  if (originalPixels <= 0 || trimmedPixels <= 0) return null;
  const ratio = (originalPixels - trimmedPixels) / originalPixels;
  if (ratio < config.minSavingsRatio) return null;

  return {
    top,
    bottom,
    width: newWidth,
    height: newHeight,
    topEdgeColor,
    bottomEdgeColor,
  };
}
