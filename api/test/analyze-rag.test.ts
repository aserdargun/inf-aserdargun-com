import sharp from "sharp";
import { describe, expect, it } from "vitest";

describe("analyze trimmed RAG", () => {
  it("samples top and bottom of trimmed image", async () => {
    const bytes = await import("node:fs/promises").then(fs => fs.readFile("/tmp/inf-debug/test-rag-trimmed.png"));
    const meta = await sharp(bytes).metadata();
    const W = meta.width!; const H = meta.height!;
    process.stderr.write(`Trimmed: ${W}x${H}\n`);
    
    // Row 0 every 50px
    const row0 = await sharp(bytes).extract({ left: 0, top: 0, width: W, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    const stride = row0.info.channels;
    process.stderr.write(`\nRow 0 every 50px:\n`);
    for (let x = 0; x < W; x += 50) {
      const i = x * stride;
      process.stderr.write(`  x=${x}: ${row0.data[i]},${row0.data[i+1]},${row0.data[i+2]}\n`);
    }
    
    // Row 5
    const row5 = await sharp(bytes).extract({ left: 0, top: 5, width: W, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    process.stderr.write(`\nRow 5 every 50px:\n`);
    for (let x = 0; x < W; x += 50) {
      const i = x * stride;
      process.stderr.write(`  x=${x}: ${row5.data[i]},${row5.data[i+1]},${row5.data[i+2]}\n`);
    }
    
    // Row 10
    const row10 = await sharp(bytes).extract({ left: 0, top: 10, width: W, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    process.stderr.write(`\nRow 10 every 50px:\n`);
    for (let x = 0; x < W; x += 50) {
      const i = x * stride;
      process.stderr.write(`  x=${x}: ${row10.data[i]},${row10.data[i+1]},${row10.data[i+2]}\n`);
    }
    
    // Row 20
    const row20 = await sharp(bytes).extract({ left: 0, top: 20, width: W, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    process.stderr.write(`\nRow 20 every 50px:\n`);
    for (let x = 0; x < W; x += 50) {
      const i = x * stride;
      process.stderr.write(`  x=${x}: ${row20.data[i]},${row20.data[i+1]},${row20.data[i+2]}\n`);
    }
    
    // Row 40
    const row40 = await sharp(bytes).extract({ left: 0, top: 40, width: W, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    process.stderr.write(`\nRow 40 every 50px:\n`);
    for (let x = 0; x < W; x += 50) {
      const i = x * stride;
      process.stderr.write(`  x=${x}: ${row40.data[i]},${row40.data[i+1]},${row40.data[i+2]}\n`);
    }
    
    // Row 50
    const row50 = await sharp(bytes).extract({ left: 0, top: 50, width: W, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    process.stderr.write(`\nRow 50 every 50px:\n`);
    for (let x = 0; x < W; x += 50) {
      const i = x * stride;
      process.stderr.write(`  x=${x}: ${row50.data[i]},${row50.data[i+1]},${row50.data[i+2]}\n`);
    }
    
    // Bottom rows
    process.stderr.write(`\n--- Bottom rows ---\n`);
    for (const y of [H-50, H-40, H-20, H-10, H-5, H-1]) {
      const row = await sharp(bytes).extract({ left: 0, top: y, width: W, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      process.stderr.write(`Row ${y} every 50px:\n`);
      for (let x = 0; x < W; x += 50) {
        const i = x * stride;
        process.stderr.write(`  x=${x}: ${row.data[i]},${row.data[i+1]},${row.data[i+2]}\n`);
      }
    }
  });
});
