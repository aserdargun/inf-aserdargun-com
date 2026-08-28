export const DEFAULT_MAX_IMAGE_BYTES = 20_000_000;
export const DEFAULT_MAX_IMAGE_PIXELS = 40_000_000;

export const supportedImageMimes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export type SupportedImageMime = (typeof supportedImageMimes)[number];

export type ImageProcessingErrorCode =
  | "INVALID_IMAGE_INPUT"
  | "UNSUPPORTED_MIME"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_DECODE_FAILED"
  | "UNSUPPORTED_IMAGE_FORMAT"
  | "MIME_MISMATCH"
  | "IMAGE_PIXEL_LIMIT_EXCEEDED"
  | "IMAGE_PROCESSING_FAILED";

export class ImageProcessingError extends Error {
  constructor(
    public readonly code: ImageProcessingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImageProcessingError";
  }
}

export interface ProcessImageInput {
  bytes: Buffer;
  declaredMime: string;
  maxBytes?: number;
  maxPixels?: number;
  /**
   * Auto-trim configuration. When omitted or `null`, trim is disabled. When
   * supplied, the trim runs after decode and before the thumbnail is built.
   */
  trim?: import("./trim-options.js").AutoTrimConfig | null;
  /**
   * Optional AI-suggested content bounding box, expressed as fractions of the
   * source image (0-1). When provided, the image is cropped to this box
   * before the auto-trim runs. Coordinates must satisfy `left<right` and
   * `top<bottom`; anything else is ignored and the crop is skipped.
   */
  crop?: { top: number; right: number; bottom: number; left: number } | null;
}

export interface ValidatedImageInput {
  bytes: Buffer;
  declaredMime: SupportedImageMime;
  maxBytes: number;
  maxPixels: number;
}

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export function validateImageInput(input: ProcessImageInput): ValidatedImageInput {
  if (!input || !Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
    throw new ImageProcessingError("INVALID_IMAGE_INPUT", "Image bytes must be a non-empty Buffer.");
  }

  const maxBytes = input.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const maxPixels = input.maxPixels ?? DEFAULT_MAX_IMAGE_PIXELS;
  if (!isPositiveSafeInteger(maxBytes) || !isPositiveSafeInteger(maxPixels)) {
    throw new ImageProcessingError("INVALID_IMAGE_INPUT", "Image limits must be positive safe integers.");
  }

  if (!supportedImageMimes.includes(input.declaredMime as SupportedImageMime)) {
    throw new ImageProcessingError("UNSUPPORTED_MIME", "The declared image MIME type is unsupported.");
  }

  if (input.bytes.length > maxBytes) {
    throw new ImageProcessingError("IMAGE_TOO_LARGE", "Image bytes exceed the allowed size.");
  }

  return {
    bytes: input.bytes,
    declaredMime: input.declaredMime as SupportedImageMime,
    maxBytes,
    maxPixels,
  };
}
