import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inflateSync } from "node:zlib";

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodeRgbPng(bytes) {
  const chunks = [];
  let width;
  let height;
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "evidence PNG must use 8-bit channels");
      assert.equal(data[9], 2, "evidence PNG must use RGB color");
      assert.equal(data[12], 0, "evidence PNG must be non-interlaced");
    } else if (type === "IDAT") {
      chunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  assert.ok(width && height && chunks.length > 0, "evidence PNG must contain image data");
  const bytesPerPixel = 3;
  const rowLength = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(chunks));
  const pixels = Buffer.alloc(rowLength * height);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[inputOffset];
    inputOffset += 1;
    for (let x = 0; x < rowLength; x += 1) {
      const source = filtered[inputOffset + x];
      const outputOffset = y * rowLength + x;
      const left = x >= bytesPerPixel ? pixels[outputOffset - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[outputOffset - rowLength] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? pixels[outputOffset - rowLength - bytesPerPixel] : 0;
      if (filter === 0) pixels[outputOffset] = source;
      else if (filter === 1) pixels[outputOffset] = (source + left) & 255;
      else if (filter === 2) pixels[outputOffset] = (source + above) & 255;
      else if (filter === 3) pixels[outputOffset] = (source + Math.floor((left + above) / 2)) & 255;
      else if (filter === 4) pixels[outputOffset] = (source + paethPredictor(left, above, upperLeft)) & 255;
      else assert.fail(`unsupported PNG filter ${filter}`);
    }
    inputOffset += rowLength;
  }
  return { width, height, pixels };
}

function fixtureCoverage(bytes) {
  const decoded = decodeRgbPng(bytes);
  let count = 0;
  let minX = decoded.width;
  let minY = decoded.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < decoded.height; y += 1) {
    for (let x = 0; x < decoded.width; x += 1) {
      const offset = (y * decoded.width + x) * 3;
      const matchesFixtureNavy = Math.abs(decoded.pixels[offset] - 16) <= 4
        && Math.abs(decoded.pixels[offset + 1] - 32) <= 4
        && Math.abs(decoded.pixels[offset + 2] - 48) <= 4;
      if (!matchesFixtureNavy) continue;
      count += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { count, spanWidth: maxX < 0 ? 0 : maxX - minX + 1, spanHeight: maxY < 0 ? 0 : maxY - minY + 1 };
}

for (const [name, width, height] of [["owner-desktop", 1280, 720], ["owner-mobile", 390, 844], ["public-desktop", 1280, 720], ["public-mobile", 390, 844]]) {
  test(`${name} is an exact production evidence PNG`, async () => {
    const bytes = await readFile(`docs/design/evidence/${name}.png`);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height); assert.ok(bytes.length > 15_000, "evidence must contain rendered detail, not an empty frame");
    const coverage = fixtureCoverage(bytes);
    assert.ok(coverage.count > 10_000, `evidence must render the deterministic navy media fixture; found ${coverage.count} matching pixels`);
    assert.ok(coverage.spanWidth > 100 && coverage.spanHeight > 100, `fixture media must occupy a two-dimensional region; found ${coverage.spanWidth}x${coverage.spanHeight}`);
  });
}
