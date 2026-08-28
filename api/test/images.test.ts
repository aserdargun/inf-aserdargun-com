import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { processImage } from "../src/images/process-image.js";

const apiRoot = process.cwd().endsWith("/api") ? process.cwd() : resolve(process.cwd(), "api");
const fixture = (name: string) => resolve(apiRoot, "test", "fixtures", name);

const validBytes = async () => readFile(fixture("valid-infographic.png"));
const validInput = async (overrides: Record<string, unknown> = {}) => ({
  bytes: await validBytes(),
  declaredMime: "image/png",
  ...overrides,
});

describe("processImage", () => {
  it("uses the exact default byte and pixel limits", async () => {
    const result = await processImage(await validInput());
    expect(result.width).toBe(1200);
    expect(result.height).toBe(600);
  });

  it("applies the AI-suggested crop before the trim", async () => {
    // Build a synthetic image with a clear top chrome strip: rows 0-99 are
    // a uniform brown, the rest is a solid dark color the auto-trim would
    // normally leave alone. The AI crop should pull the top strip off
    // even though its color is close to the content. The crop asks for
    // top=100/H, so the resulting height must be at most H-100 (the
    // sanitizer's small half-percent outward pad is well within that).
    const W = 400, H = 600;
    const data = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 3;
        if (y < 100) { data[i] = 120; data[i + 1] = 80; data[i + 2] = 50; }
        else { data[i] = 30; data[i + 1] = 30; data[i + 2] = 30; }
      }
    }
    const bytes = await sharp(data, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
    const result = await processImage({ bytes, declaredMime: "image/png", crop: { top: 100 / H, right: 1, bottom: 1, left: 0 } });
    expect(result.width).toBe(W);
    expect(result.height).toBeLessThanOrEqual(H - 95);
  });

  it("ignores a degenerate AI crop and falls back to the trim", async () => {
    const result = await processImage({ bytes: await validBytes(), declaredMime: "image/png", crop: { top: 0.5, right: 0.5, bottom: 0.2, left: 0.8 } });
    // No crash, no shrink from a malformed box
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("accepts an image exactly at the declared byte boundary", async () => {
    const bytes = await validBytes();
    await expect(processImage(await validInput({ maxBytes: bytes.length }))).resolves.toMatchObject({
      detectedMime: "image/png",
    });
  });

  it("rejects an oversize payload before attempting to decode it", async () => {
    await expect(processImage({
      bytes: Buffer.from("not decodable"),
      declaredMime: "image/png",
      maxBytes: 1,
    })).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  });

  it.each([
    { label: "empty bytes", bytes: Buffer.alloc(0) },
    { label: "zero byte limit", bytes: Buffer.from("x"), maxBytes: 0 },
    { label: "zero pixel limit", bytes: Buffer.from("x"), maxPixels: 0 },
    { label: "unsafe byte limit", bytes: Buffer.from("x"), maxBytes: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects invalid image input: $label", async ({ bytes, maxBytes, maxPixels }) => {
    await expect(processImage({ bytes, declaredMime: "image/png", maxBytes, maxPixels })).rejects.toMatchObject({
      code: "INVALID_IMAGE_INPUT",
    });
  });

  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpeg"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
    ["image/avif", "avif"],
  ] as const)("accepts and detects %s without trusting its declaration", async (declaredMime, format) => {
    const bytes = await sharp(await validBytes()).toFormat(format).toBuffer();
    const result = await processImage({ bytes, declaredMime });
    expect(result.detectedMime).toBe(declaredMime);
  });

  it("uses decoded AVIF media type rather than rejecting its ISO-BMFF container details", async () => {
    const bytes = await sharp(await validBytes()).avif().toBuffer();
    const metadata = await sharp(bytes).metadata();

    expect(metadata).toMatchObject({ format: "heif", mediaType: "image/avif" });
    await expect(processImage({ bytes, declaredMime: "image/avif" })).resolves.toMatchObject({
      detectedMime: "image/avif",
    });
  });

  it("rejects a HEIF whose minor version merely spells the AVIF brand", async () => {
    const avif = await sharp(await validBytes()).avif().toBuffer();
    const spoof = Buffer.from(avif);
    const ftypSize = spoof.readUInt32BE(0);
    spoof.write("heic", 8, "ascii");
    spoof.write("avif", 12, "ascii");
    for (let offset = 16; offset + 4 <= ftypSize; offset += 4) spoof.write("heic", offset, "ascii");

    const metadata = await sharp(spoof).metadata();
    expect(metadata).toMatchObject({ format: "heif", mediaType: "image/heic" });
    await expect(processImage({ bytes: spoof, declaredMime: "image/avif" })).rejects.toMatchObject({
      code: "UNSUPPORTED_IMAGE_FORMAT",
    });
  });

  it("rejects a declaration outside the standard supported image MIME values", async () => {
    await expect(processImage(await validInput({ declaredMime: "image/svg+xml" }))).rejects.toMatchObject({
      code: "UNSUPPORTED_MIME",
    });
  });

  it("rejects a MIME declaration that does not match decoded content", async () => {
    await expect(processImage(await validInput({ declaredMime: "image/jpeg" }))).rejects.toMatchObject({
      code: "MIME_MISMATCH",
    });
  });

  it("rejects undecodable bytes even when their declaration has an allowed MIME", async () => {
    await expect(processImage({
      bytes: await readFile(fixture("not-an-image.png")),
      declaredMime: "image/png",
    })).rejects.toMatchObject({ code: "IMAGE_DECODE_FAILED" });
  });

  it("rejects an unsupported decoded format before comparing its declaration", async () => {
    const bytes = await sharp(await validBytes()).tiff().toBuffer();
    await expect(processImage({ bytes, declaredMime: "image/png" })).rejects.toMatchObject({
      code: "UNSUPPORTED_IMAGE_FORMAT",
    });
  });

  it("rejects images whose decoded pixels exceed the limit and accepts the exact boundary", async () => {
    await expect(processImage(await validInput({ maxPixels: 719_999 }))).rejects.toMatchObject({
      code: "IMAGE_PIXEL_LIMIT_EXCEEDED",
    });
    await expect(processImage(await validInput({ maxPixels: 720_000 }))).resolves.toMatchObject({
      width: 1200,
      height: 600,
    });
  });

  it("preserves original bytes as an independent copy and calculates SHA-256 over them", async () => {
    const input = await validInput();
    const before = Buffer.from(input.bytes);
    const result = await processImage(input);

    expect(input.bytes).toEqual(before);
    expect(result.originalBytes).not.toBe(input.bytes);
    expect(result.originalBytes.equals(before)).toBe(true);
    expect(result.sha256).toBe("4ae367dfebd3d426316f8443d9bf6f69fb3cbed5868b336d6cf7c2c30bfe6aa1");
    expect(result.sha256).toBe(createHash("sha256").update(before).digest("hex"));

    input.bytes.fill(0);
    expect(result.originalBytes.equals(before)).toBe(true);
  });

  it("produces a decodable bounded WebP thumbnail", async () => {
    const result = await processImage(await validInput());
    const metadata = await sharp(result.thumbnailBytes).metadata();

    expect(result.thumbnailMime).toBe("image/webp");
    expect(metadata.format).toBe("webp");
    expect(result.thumbnailWidth).toBe(metadata.width);
    expect(result.thumbnailHeight).toBe(metadata.height);
    expect(result.thumbnailWidth).toBeLessThanOrEqual(960);
    expect(result.thumbnailHeight).toBeLessThanOrEqual(960);
  });

  it("does not enlarge a small image in its thumbnail", async () => {
    const bytes = await sharp({
      create: { width: 20, height: 10, channels: 3, background: "#112233" },
    }).png().toBuffer();
    const result = await processImage({ bytes, declaredMime: "image/png" });

    expect([result.thumbnailWidth, result.thumbnailHeight]).toEqual([20, 10]);
  });

  it("rotates thumbnail pixels according to embedded orientation", async () => {
    const bytes = await sharp({
      create: { width: 1200, height: 600, channels: 3, background: "#112233" },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await processImage({ bytes, declaredMime: "image/jpeg" });

    expect([result.width, result.height]).toEqual([600, 1200]);
    expect([result.thumbnailWidth, result.thumbnailHeight]).toEqual([480, 960]);
  });
});
