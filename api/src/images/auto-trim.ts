import sharp, { type Metadata } from "sharp";

/**
 * Auto-trim removes solid background margins from screenshot-like inputs so the
 * stored file reflects the content's tight bounding box. The function is
 * deliberately conservative: any failure or uncertain signal returns the input
 * untouched so the saved file is never smaller or more lossy than the user
 * uploaded.
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

const DEFAULT_THRESHOLD = 10;
const DEFAULT_MIN_SAVINGS = 0.02;
const DEFAULT_MIN_DIMENSION = 100;
const DEFAULT_MAX_PIXELS = 40_000_000;
const CORNER_BLOCK = 8;

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

async function sampleBackground(bytes: Buffer, width: number, height: number, maxPixels: number): Promise<BackgroundSample | null> {
  const block = Math.min(CORNER_BLOCK, width, height);
  if (block <= 0) return null;
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: maxPixels })
      .extract({ left: 0, top: 0, width: block, height: block })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const channels = info.channels >= 3 ? info.channels : 3;
    const stride = info.channels;
    const pixelCount = data.length / stride;
    if (pixelCount <= 0) return null;
    let r = 0; let g = 0; let b = 0; let a = 0;
    for (let i = 0; i < data.length; i += stride) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      if (channels >= 4) a += data[i + 3];
    }
    const alpha = channels >= 4 ? a / pixelCount : 1;
    return { r: r / pixelCount, g: g / pixelCount, b: b / pixelCount, alpha, channels };
  } catch {
    return null;
  }
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

  const sample = await sampleBackground(bytes, dims.width, dims.height, opts.maxPixels);
  if (!sample) return asNoTrim(bytes, dims);

  const isTransparentCanvas = sample.alpha < 0.5;
  const background = isTransparentCanvas
    ? { r: 0, g: 0, b: 0, alpha: 0 }
    : { r: sample.r, g: sample.g, b: sample.b, alpha: 1 };

  let trimmedBytes: Buffer;
  try {
    const pipeline = sharp(bytes, { limitInputPixels: opts.maxPixels });
    if (isTransparentCanvas) {
      trimmedBytes = await pipeline
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: opts.threshold })
        .toBuffer();
    } else {
      trimmedBytes = await pipeline
        .trim({ background: { r: background.r, g: background.g, b: background.b }, threshold: opts.threshold })
        .toBuffer();
    }
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

  const originalPixels = dims.width * dims.height;
  const trimmedPixels = trimmedDims.width * trimmedDims.height;
  if (originalPixels <= 0 || trimmedPixels <= 0) return asNoTrim(bytes, dims);
  if (trimmedDims.width >= dims.width && trimmedDims.height >= dims.height) return asNoTrim(bytes, dims);

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
