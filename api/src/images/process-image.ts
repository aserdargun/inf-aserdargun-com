import sharp, { type Metadata } from "sharp";
import { autoTrimBytes, type AutoTrimConfig } from "./auto-trim.js";
import { sha256 } from "./hash.js";
import { DISABLED_AUTO_TRIM } from "./trim-options.js";
import {
  type ImageProcessingErrorCode,
  ImageProcessingError,
  type ProcessImageInput,
  type SupportedImageMime,
  validateImageInput,
} from "./validate-image.js";

export type { ImageProcessingErrorCode, ProcessImageInput, SupportedImageMime } from "./validate-image.js";
export { ImageProcessingError } from "./validate-image.js";

export interface ProcessedImage {
  /**
   * An independent copy of the bytes that will be stored as the original file.
   * If auto-trim is enabled and the input had solid margins, this is the
   * cropped output. The bytes are copied so the caller's buffer cannot mutate
   * the stored file.
   */
  originalBytes: Buffer;
  detectedMime: SupportedImageMime;
  width: number;
  height: number;
  sha256: string;
  thumbnailBytes: Buffer;
  thumbnailMime: "image/webp";
  thumbnailWidth: number;
  thumbnailHeight: number;
  /** True when auto-trim cropped the input. */
  trimApplied: boolean;
  /** Width before trim (equals `width` when `trimApplied` is false). */
  originalWidth: number;
  /** Height before trim (equals `height` when `trimApplied` is false). */
  originalHeight: number;
}

const sharpOptions = (maxPixels: number) => ({ limitInputPixels: maxPixels });

function toTrimConfig(trim: AutoTrimConfig | null | undefined): AutoTrimConfig {
  if (!trim) return DISABLED_AUTO_TRIM;
  return { ...trim };
}

const imageMimeBySharpFormat: Record<string, Exclude<SupportedImageMime, "image/avif">> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function detectedMime(metadata: Metadata): SupportedImageMime | null {
  if (metadata.format === "heif") return metadata.mediaType === "image/avif" ? "image/avif" : null;
  return imageMimeBySharpFormat[metadata.format ?? ""] ?? null;
}

function requirePositiveDimension(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new ImageProcessingError("IMAGE_DECODE_FAILED", `Decoded image has an invalid ${label}.`);
  }
  return value;
}

function checkedMultiply(left: number, right: number): number {
  if (left > Number.MAX_SAFE_INTEGER / right) {
    throw new ImageProcessingError("IMAGE_PIXEL_LIMIT_EXCEEDED", "Decoded image dimensions are unsafe.");
  }
  return left * right;
}

function dimensionsWithinPixelLimit(metadata: Metadata, maxPixels: number): { width: number; height: number } {
  const width = requirePositiveDimension(metadata.width, "width");
  const height = requirePositiveDimension(metadata.pageHeight ?? metadata.height, "height");
  const pages = requirePositiveDimension(metadata.pages ?? 1, "page count");
  const totalPixels = checkedMultiply(checkedMultiply(width, height), pages);
  if (totalPixels > maxPixels) {
    throw new ImageProcessingError("IMAGE_PIXEL_LIMIT_EXCEEDED", "Decoded image pixels exceed the allowed limit.");
  }
  return { width, height };
}

function logicalDimensions(metadata: Metadata, raw: { width: number; height: number }): { width: number; height: number } {
  if (metadata.autoOrient === undefined) return raw;
  return {
    width: requirePositiveDimension(metadata.autoOrient.width, "oriented width"),
    height: requirePositiveDimension(metadata.autoOrient.height, "oriented height"),
  };
}

function isSharpPixelLimitError(error: unknown): boolean {
  return error instanceof Error && /pixel limit|input image exceeds/i.test(error.message);
}

function decodeError(error: unknown): ImageProcessingError {
  if (isSharpPixelLimitError(error)) {
    return new ImageProcessingError("IMAGE_PIXEL_LIMIT_EXCEEDED", "Decoded image pixels exceed the allowed limit.");
  }
  return new ImageProcessingError("IMAGE_DECODE_FAILED", "Image bytes could not be decoded.");
}

async function readSourceMetadata(bytes: Buffer, maxPixels: number): Promise<Metadata> {
  try {
    return await sharp(bytes, { ...sharpOptions(maxPixels), animated: true, pages: -1 }).metadata();
  } catch (error) {
    throw decodeError(error);
  }
}

async function makeThumbnail(bytes: Buffer, maxPixels: number): Promise<Buffer> {
  try {
    return await sharp(bytes, sharpOptions(maxPixels))
      .rotate()
      .resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (error) {
    throw new ImageProcessingError(
      isSharpPixelLimitError(error) ? "IMAGE_PIXEL_LIMIT_EXCEEDED" : "IMAGE_PROCESSING_FAILED",
      "Image thumbnail could not be created.",
    );
  }
}

async function validatedThumbnailMetadata(bytes: Buffer): Promise<{ width: number; height: number }> {
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 960 * 960 }).metadata();
    if (metadata.format !== "webp") {
      throw new ImageProcessingError("IMAGE_PROCESSING_FAILED", "Thumbnail is not WebP.");
    }
    const width = requirePositiveDimension(metadata.width, "thumbnail width");
    const height = requirePositiveDimension(metadata.height, "thumbnail height");
    if (width > 960 || height > 960) {
      throw new ImageProcessingError("IMAGE_PROCESSING_FAILED", "Thumbnail dimensions exceed their bounds.");
    }
    return { width, height };
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;
    throw new ImageProcessingError("IMAGE_PROCESSING_FAILED", "Image thumbnail could not be decoded.");
  }
}

export async function processImage(input: ProcessImageInput): Promise<ProcessedImage> {
  const validated = validateImageInput(input);
  const sourceBytes = Buffer.from(validated.bytes);
  const metadata = await readSourceMetadata(sourceBytes, validated.maxPixels);
  const detected = detectedMime(metadata);
  if (detected === null) {
    throw new ImageProcessingError("UNSUPPORTED_IMAGE_FORMAT", "Decoded image format is unsupported.");
  }
  if (detected !== validated.declaredMime) {
    throw new ImageProcessingError("MIME_MISMATCH", "Declared MIME type does not match decoded image content.");
  }
  const rawDimensions = dimensionsWithinPixelLimit(metadata, validated.maxPixels);
  const dimensions = logicalDimensions(metadata, rawDimensions);

  const trimConfig = toTrimConfig(input.trim);
  const trimResult = trimConfig.enabled
    ? await autoTrimBytes(sourceBytes, {
        threshold: trimConfig.threshold,
        minSavingsRatio: trimConfig.minSavingsRatio,
        minDimension: trimConfig.minDimension,
        maxPixels: trimConfig.maxPixels,
      })
    : null;
  const originalBytes = trimResult?.bytes ?? sourceBytes;
  const storedDimensions = trimResult
    ? { width: trimResult.width, height: trimResult.height }
    : dimensions;
  const trimApplied = !!trimResult?.trimmed;
  const originalWidth = trimResult?.originalWidth ?? dimensions.width;
  const originalHeight = trimResult?.originalHeight ?? dimensions.height;

  const thumbnailBytes = await makeThumbnail(originalBytes, validated.maxPixels);
  const thumbnail = await validatedThumbnailMetadata(thumbnailBytes);

  return {
    originalBytes,
    detectedMime: detected,
    width: storedDimensions.width,
    height: storedDimensions.height,
    sha256: sha256(originalBytes),
    thumbnailBytes,
    thumbnailMime: "image/webp",
    thumbnailWidth: thumbnail.width,
    thumbnailHeight: thumbnail.height,
    trimApplied,
    originalWidth,
    originalHeight,
  };
}
