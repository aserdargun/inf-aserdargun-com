import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

for (const [name, width, height] of [["owner-desktop", 1280, 720], ["owner-mobile", 390, 844], ["public-desktop", 1280, 720], ["public-mobile", 390, 844]]) {
  test(`${name} is an exact production evidence PNG`, async () => {
    const bytes = await readFile(`docs/design/evidence/${name}.png`);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height); assert.ok(bytes.length > 15_000, "evidence must contain rendered detail, not an empty frame");
  });
}
