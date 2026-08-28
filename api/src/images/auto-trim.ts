import sharp, { type Metadata } from "sharp";

/**
 * Auto-trim removes solid background margins from screenshot-like inputs so the
 * stored file reflects the content's tight bounding box. The function is
 * deliberately conservative: any failure or uncertain signal returns the input
 * untouched so the saved file is never smaller or more lossy than the user
 * uploaded.
 *
 * The detector walks all four edges independently so an image with, say, a
 * white left/right margin and a black top toolbar still gets the borders
 * cropped. A single-color screenshot (the common case) is detected by
 * comparing the four corner samples and delegated to sharp's `trim` to keep
 * the per-pixel cost low.
 */

export interface AutoTrimOptions {
  threshold?: number;
  minSavingsRatio?: number;
  minDimension?: number;
  maxPixels?: number;
}

export interface AutoTrimConfig {
  enabled: boolean;
  threshold: number;
  minSavingsRatio: number;
  minDimension: number;
  maxPixels: number;
}

export interface AutoTrimResult {
  bytes: Buffer;
  width: number;
  height: number;
  trimmed: boolean;
  originalWidth: number;
  originalHeight: number;
  savedPixelRatio: number;
  detectedBackground: { r: number; g: number; b: number; alpha: number } | null;
}

interface BackgroundSample { r: number; g: number; b: number; alpha: number; channels: number; }

interface CornerSamples { topLeft: BackgroundSample | null; topRight: BackgroundSample | null; bottomLeft: BackgroundSample | null; bottomRight: BackgroundSample | null; }

const DEFAULT_THRESHOLD = 10;
const DEFAULT_MIN_SAVINGS = 0.02;
const DEFAULT_MIN_DIMENSION = 100;
const DEFAULT_MAX_PIXELS = 40_000_000;
const CORNER_BLOCK = 8;
const EDGE_SAMPLE_STRIP = 4;

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeOptions(options: AutoTrimOptions | undefined): Required<AutoTrimOptions> {
  return {
    threshold: clamp(options?.threshold ?? DEFAULT_THRESHOLD, 0, 255),
    minSavingsRatio: clamp(options?.minSavingsRatio ?? DEFAULT_MIN_SAVINGS, 0, 1),
    minDimension: Math.max(1, Math.floor(options?.minDimension ?? DEFAULT_MIN_DIMENSION)),
    maxPixels: Math.max(1, Math.floor(options?.maxPixels ?? DEFAULT_MAX_PIXELS)),
  };
}

function asNoTrim(bytes: Buffer, metadata: { width: number; height: number }): AutoTrimResult {
  return {
    bytes,
    width: metadata.width,
    height: metadata.height,
    trimmed: false,
    originalWidth: metadata.width,
    originalHeight: metadata.height,
    savedPixelRatio: 0,
    detectedBackground: null,
  };
}

function isAnimated(metadata: Metadata): boolean {
  const pages = metadata.pages;
  return typeof pages === "number" && pages > 1;
}

function safeMetadata(metadata: Metadata): { width: number; height: number } | null {
  if (typeof metadata.width !== "number" || metadata.width <= 0) return null;
  const pageHeight = metadata.pageHeight ?? metadata.height;
  if (typeof pageHeight !== "number" || pageHeight <= 0) return null;
  return { width: metadata.width, height: pageHeight };
}

function averagePixels(data: Uint8Array, stride: number, channels: number): { r: number; g: number; b: number; alpha: number } {
  const pixelCount = data.length / stride;
  if (pixelCount <= 0) return { r: 0, g: 0, b: 0, alpha: 0 };
  let r = 0; let g = 0; let b = 0; let a = 0;
  for (let i = 0; i < data.length; i += stride) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    if (channels >= 4) a += data[i + 3];
  }
  return { r: r / pixelCount, g: g / pixelCount, b: b / pixelCount, alpha: channels >= 4 ? a / pixelCount : 1 };
}

async function sampleRect(
  bytes: Buffer,
  maxPixels: number,
  region: { left: number; top: number; width: number; height: number },
): Promise<BackgroundSample | null> {
  if (region.width <= 0 || region.height <= 0) return null;
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: maxPixels })
      .extract(region)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const channels = info.channels >= 3 ? info.channels : 3;
    const avg = averagePixels(data, info.channels, channels);
    return { ...avg, channels };
  } catch {
    return null;
  }
}

async function sampleAllCorners(bytes: Buffer, width: number, height: number, maxPixels: number): Promise<CornerSamples> {
  const block = Math.min(CORNER_BLOCK, width, height);
  if (block <= 0) return { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
  const [topLeft, topRight, bottomLeft, bottomRight] = await Promise.all([
    sampleRect(bytes, maxPixels, { left: 0, top: 0, width: block, height: block }),
    sampleRect(bytes, maxPixels, { left: width - block, top: 0, width: block, height: block }),
    sampleRect(bytes, maxPixels, { left: 0, top: height - block, width: block, height: block }),
    sampleRect(bytes, maxPixels, { left: width - block, top: height - block, width: block, height: block }),
  ]);
  return { topLeft, topRight, bottomLeft, bottomRight };
}

function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

function cornersAgree(corners: CornerSamples, threshold: number): boolean {
  const present = [corners.topLeft, corners.topRight, corners.bottomLeft, corners.bottomRight].filter((c): c is BackgroundSample => c !== null);
  if (present.length === 0) return false;
  const first = present[0]!;
  for (let i = 1; i < present.length; i += 1) {
    if (colorDistance(first, present[i]!) > threshold) return false;
  }
  return true;
}

function anyTransparentCanvas(corners: CornerSamples): boolean {
  return [corners.topLeft, corners.topRight, corners.bottomLeft, corners.bottomRight].some((sample) => sample !== null && sample.alpha < 0.5);
}

function edgesAgree(
  edges: { top: BackgroundSample; bottom: BackgroundSample; left: BackgroundSample; right: BackgroundSample },
  threshold: number,
): boolean {
  const samples = [edges.top, edges.bottom, edges.left, edges.right];
  const first = samples[0]!;
  for (let i = 1; i < samples.length; i += 1) {
    if (colorDistance(first, samples[i]!) > threshold) return false;
  }
  return true;
}

async function sampleEdge(
  bytes: Buffer,
  maxPixels: number,
  side: "top" | "bottom" | "left" | "right",
  width: number,
  height: number,
): Promise<BackgroundSample | null> {
  const strip = Math.min(EDGE_SAMPLE_STRIP, side === "left" || side === "right" ? height : width);
  if (strip <= 0) return null;
  // Sample a strip that avoids the corners, which sit at the intersection of
  // two edges and therefore mix two solid background colors. The middle 60%
  // of each side is always inside a single border.
  const sideLength = side === "left" || side === "right" ? height : width;
  const margin = Math.max(strip, Math.floor(sideLength * 0.2));
  const innerFrom = margin;
  const innerTo = sideLength - margin;
  if (innerTo <= innerFrom) return null;
  const region = side === "top" ? { left: innerFrom, top: 0, width: innerTo - innerFrom, height: strip }
    : side === "bottom" ? { left: innerFrom, top: height - strip, width: innerTo - innerFrom, height: strip }
      : side === "left" ? { left: 0, top: innerFrom, width: strip, height: innerTo - innerFrom }
        : { left: width - strip, top: innerFrom, width: strip, height: innerTo - innerFrom };
  return sampleRect(bytes, maxPixels, region);
}

interface RawImage { data: Uint8Array; channels: number; width: number; height: number; }

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

function pixelAt(raw: RawImage, x: number, y: number): { r: number; g: number; b: number; a: number } {
  const stride = raw.channels;
  const i = (y * raw.width + x) * stride;
  return { r: raw.data[i]!, g: raw.data[i + 1]!, b: raw.data[i + 2]!, a: raw.data[i + 3] ?? 255 };
}

// Minimum fraction of a row/column that must match the target color for the
// row to count as a solid border. A 70% match lets a border carry a header
// line, a few icons, or a thin secondary outline without aborting the walk,
// while still rejecting rows that are genuinely mixed content. The previous
// "all pixels must match" rule was too strict for screenshots whose top edge
// holds the page title in a contrasting color.
const ROW_MATCH_RATIO = 0.7;

function rowMatchesExcludingCorners(
  raw: RawImage,
  y: number,
  target: { r: number; g: number; b: number; a: number },
  threshold: number,
  cornerMargin: number,
): boolean {
  // A small region at each end of the row can carry a different color when
  // the corner hosts a design element (a "tab", a label, a colored bracket).
  // Skipping that region lets the walk see the actual edge color, otherwise
  // the trim aborts on the first row because the corners do not match.
  const fromX = Math.min(cornerMargin, Math.floor(raw.width / 2));
  const toX = Math.max(fromX + 1, raw.width - fromX);
  const span = toX - fromX;
  const minMatches = Math.max(1, Math.floor(span * ROW_MATCH_RATIO));
  let matches = 0;
  for (let x = fromX; x < toX; x += 1) {
    const p = pixelAt(raw, x, y);
    if (Math.abs(p.r - target.r) <= threshold && Math.abs(p.g - target.g) <= threshold && Math.abs(p.b - target.b) <= threshold && Math.abs(p.a - target.a) <= threshold) {
      matches += 1;
      if (matches >= minMatches) return true;
    }
  }
  return false;
}

function columnMatchesBetween(
  raw: RawImage,
  x: number,
  target: { r: number; g: number; b: number; a: number },
  threshold: number,
  fromY: number,
  toY: number,
): boolean {
  const span = toY - fromY;
  const minMatches = Math.max(1, Math.floor(span * ROW_MATCH_RATIO));
  let matches = 0;
  for (let y = fromY; y < toY; y += 1) {
    const p = pixelAt(raw, x, y);
    if (Math.abs(p.r - target.r) <= threshold && Math.abs(p.g - target.g) <= threshold && Math.abs(p.b - target.b) <= threshold && Math.abs(p.a - target.a) <= threshold) {
      matches += 1;
      if (matches >= minMatches) return true;
    }
  }
  return false;
}

interface EdgeTrims { top: number; bottom: number; left: number; right: number; }

function computeEdgeTrims(
  raw: RawImage,
  edges: { top: BackgroundSample | null; bottom: BackgroundSample | null; left: BackgroundSample | null; right: BackgroundSample | null },
  threshold: number,
): EdgeTrims | null {
  if (!edges.top || !edges.bottom || !edges.left || !edges.right) return null;
  const topTarget = { r: edges.top.r, g: edges.top.g, b: edges.top.b, a: edges.top.alpha };
  const bottomTarget = { r: edges.bottom.r, g: edges.bottom.g, b: edges.bottom.b, a: edges.bottom.alpha };
  const leftTarget = { r: edges.left.r, g: edges.left.g, b: edges.left.b, a: edges.left.alpha };
  const rightTarget = { r: edges.right.r, g: edges.right.g, b: edges.right.b, a: edges.right.alpha };
  // Skip a small region at each corner of the row/column so a design element
  // stuck to one corner (a colored tab, a fold, a badge) does not abort the
  // walk on the very first pixel. The cap scales with the dimension so a tall
  // narrow image does not eat the whole row and a wide one does not lose its
  // middle.
  const rowCornerMargin = Math.max(8, Math.floor(Math.min(raw.width, raw.height) * 0.05));
  // Walk the top rows first. Each row must be uniform top color across the
  // middle band — once the inner content shows up the row stops matching.
  let top = 0;
  while (top < raw.height && rowMatchesExcludingCorners(raw, top, topTarget, threshold, rowCornerMargin)) top += 1;
  // Walk the bottom rows. A row that overlaps the top trim cannot also count
  // as bottom trim, so we cap the walk to keep the bounding box consistent.
  let bottom = 0;
  while (bottom < raw.height - top && rowMatchesExcludingCorners(raw, raw.height - 1 - bottom, bottomTarget, threshold, rowCornerMargin)) bottom += 1;
  // The left/right columns only see the middle band between the already-found
  // top and bottom borders, and skip a small region at the top/bottom of each
  // column for the same reason as the row corner margin.
  const bandFromY = top + rowCornerMargin;
  const bandToY = raw.height - bottom - rowCornerMargin;
  if (bandToY <= bandFromY) return null;
  let left = 0;
  while (left < raw.width && columnMatchesBetween(raw, left, leftTarget, threshold, bandFromY, bandToY)) left += 1;
  let right = 0;
  while (right < raw.width - left && columnMatchesBetween(raw, raw.width - 1 - right, rightTarget, threshold, bandFromY, bandToY)) right += 1;
  if (top + bottom >= raw.height || left + right >= raw.width) return null;
  return { top, bottom, left, right };
}

export async function autoTrimBytes(bytes: Buffer, options?: AutoTrimOptions): Promise<AutoTrimResult> {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    return { bytes, width: 0, height: 0, trimmed: false, originalWidth: 0, originalHeight: 0, savedPixelRatio: 0, detectedBackground: null };
  }
  const opts = normalizeOptions(options);

  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: opts.maxPixels, animated: true, pages: -1 }).metadata();
  } catch {
    return asNoTrim(bytes, { width: 0, height: 0 });
  }

  if (isAnimated(metadata)) return asNoTrim(bytes, safeMetadata(metadata) ?? { width: 0, height: 0 });

  const dims = safeMetadata(metadata);
  if (!dims) return asNoTrim(bytes, { width: 0, height: 0 });
  if (dims.width < opts.minDimension || dims.height < opts.minDimension) return asNoTrim(bytes, dims);

  // Sample the four corners AND the four edge strips. The corners decide the
  // "fast path" (a single solid background where sharp's optimized `trim`
  // wins), but the edge strips are what the per-edge walk actually uses —
  // corners can carry a design element (a tab, a label) that differs from the
  // rest of the edge. When the corners and the edge strips disagree, we skip
  // the fast path and walk each edge against its own strip color.
  const corners = await sampleAllCorners(bytes, dims.width, dims.height, opts.maxPixels);
  const edges = {
    top: await sampleEdge(bytes, opts.maxPixels, "top", dims.width, dims.height),
    bottom: await sampleEdge(bytes, opts.maxPixels, "bottom", dims.width, dims.height),
    left: await sampleEdge(bytes, opts.maxPixels, "left", dims.width, dims.height),
    right: await sampleEdge(bytes, opts.maxPixels, "right", dims.width, dims.height),
  };
  if (!corners.topLeft && !corners.topRight && !corners.bottomLeft && !corners.bottomRight) return asNoTrim(bytes, dims);
  if (!edges.top || !edges.bottom || !edges.left || !edges.right) return asNoTrim(bytes, dims);

  // The fast path is safe only when both the corners and the edge strips
  // agree on a single color. If they disagree, the corner likely holds a
  // design element and the per-edge walk must do the work.
  const cornersUnanimous = anyTransparentCanvas(corners) || cornersAgree(corners, opts.threshold);
  const edgesUnanimous = edgesAgree(edges as { top: BackgroundSample; bottom: BackgroundSample; left: BackgroundSample; right: BackgroundSample }, opts.threshold);
  if (cornersUnanimous && edgesUnanimous) {
    const reference = corners.topLeft ?? corners.topRight ?? corners.bottomLeft ?? corners.bottomRight;
    if (!reference) return asNoTrim(bytes, dims);
    const isTransparentCanvas = reference.alpha < 0.5;
    const background = isTransparentCanvas
      ? { r: 0, g: 0, b: 0, alpha: 0 }
      : { r: reference.r, g: reference.g, b: reference.b, alpha: 1 };
    let trimmedBytes: Buffer;
    try {
      const pipeline = sharp(bytes, { limitInputPixels: opts.maxPixels });
      trimmedBytes = await pipeline.trim({ background, threshold: opts.threshold }).toBuffer();
    } catch {
      return asNoTrim(bytes, dims);
    }
    let trimmedMetadata: Metadata;
    try {
      trimmedMetadata = await sharp(trimmedBytes, { limitInputPixels: opts.maxPixels }).metadata();
    } catch {
      return asNoTrim(bytes, dims);
    }
    const trimmedDims = safeMetadata(trimmedMetadata);
    if (!trimmedDims) return asNoTrim(bytes, dims);
    if (trimmedDims.width >= dims.width && trimmedDims.height >= dims.height) return asNoTrim(bytes, dims);
    const originalPixels = dims.width * dims.height;
    const trimmedPixels = trimmedDims.width * trimmedDims.height;
    if (originalPixels <= 0 || trimmedPixels <= 0) return asNoTrim(bytes, dims);
    const ratio = (originalPixels - trimmedPixels) / originalPixels;
    if (ratio < opts.minSavingsRatio) return asNoTrim(bytes, dims);
    return {
      bytes: trimmedBytes,
      width: trimmedDims.width,
      height: trimmedDims.height,
      trimmed: true,
      originalWidth: dims.width,
      originalHeight: dims.height,
      savedPixelRatio: ratio,
      detectedBackground: { r: background.r, g: background.g, b: background.b, alpha: background.alpha },
    };
  }

  // Corners disagree (or the corner color does not match the edges): per-edge
  // detection. Each edge is walked against its own strip color, with a corner
  // margin so a design element at the corner does not abort the walk.
  const raw = await readRaw(bytes, opts.maxPixels);
  if (!raw) return asNoTrim(bytes, dims);
  const trims = computeEdgeTrims(raw, edges, opts.threshold);
  if (!trims) return asNoTrim(bytes, dims);

  const newWidth = dims.width - trims.left - trims.right;
  const newHeight = dims.height - trims.top - trims.bottom;
  if (newWidth <= 0 || newHeight <= 0) return asNoTrim(bytes, dims);
  if (newWidth >= dims.width && newHeight >= dims.height) return asNoTrim(bytes, dims);

  const originalPixels = dims.width * dims.height;
  const trimmedPixels = newWidth * newHeight;
  const ratio = (originalPixels - trimmedPixels) / originalPixels;
  if (ratio < opts.minSavingsRatio) return asNoTrim(bytes, dims);

  let trimmedBytes: Buffer;
  try {
    trimmedBytes = await sharp(bytes, { limitInputPixels: opts.maxPixels })
      .extract({ left: trims.left, top: trims.top, width: newWidth, height: newHeight })
      .toBuffer();
  } catch {
    return asNoTrim(bytes, dims);
  }
  return {
    bytes: trimmedBytes,
    width: newWidth,
    height: newHeight,
    trimmed: true,
    originalWidth: dims.width,
    originalHeight: dims.height,
    savedPixelRatio: ratio,
    detectedBackground: { r: edges.top?.r ?? 0, g: edges.top?.g ?? 0, b: edges.top?.b ?? 0, alpha: edges.top?.alpha ?? 1 },
  };
}
