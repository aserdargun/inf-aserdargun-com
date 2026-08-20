import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

describe("lint contract", () => {
  test("reports real rule violations in TypeScript and TSX input", () => {
    const directory = mkdtempSync(join(process.cwd(), ".lint-contract-"));
    const typescriptFile = join(directory, "undefined.ts");
    const tsxFile = join(directory, "undefined.tsx");

    writeFileSync(typescriptFile, "export const value: string = missingRuntimeValue;\n");
    writeFileSync(tsxFile, "export function Broken() { return <main>{missingName}</main>; }\n");

    try {
      const result = spawnSync("pnpm", ["exec", "eslint", "--no-warn-ignored", typescriptFile, tsxFile], {
        cwd: process.cwd(),
        encoding: "utf8"
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("undefined.ts");
      expect(result.stdout).toContain("undefined.tsx");
      expect(result.stdout.match(/no-undef/g)).toHaveLength(2);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
