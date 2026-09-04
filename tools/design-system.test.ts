import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Evolutionary 2.0 design system", () => {
  test("loads the five style responsibilities in stable order", () => {
    expect(read("app/globals.css")).toBe(`@import "tailwindcss";\n@import "../styles/tokens.css";\n@import "../styles/base.css";\n@import "../styles/shell.css";\n@import "../styles/components.css";\n@import "../styles/routes.css";\n`);
  });

  test("publishes approved light and dark semantic tokens", () => {
    const tokens = read("styles/tokens.css");
    expect(tokens).toContain("--bg-canvas: #f3f0e7");
    expect(tokens).toContain("--navigation-surface: rgba(255, 254, 250, 0.86)");
    expect(tokens).toContain("--accent: #365fe5");
    expect(tokens).toContain(':root[data-theme="dark"]');
    expect(tokens).toContain("--bg-canvas: #0c0f0d");
    expect(tokens).toContain("--navigation-surface: rgba(20, 24, 20, 0.86)");
    expect(tokens).toContain("--accent: #88a1ff");
  });

  test("keeps fonts and motion local", () => {
    const css = ["tokens", "base", "shell", "components", "routes"].map((name) => read(`styles/${name}.css`)).join("\n");
    expect(css).not.toMatch(/https?:\/\/|@font-face/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  test("keeps the public grid in its tablet layout through 1099px", () => {
    const routes = read("styles/routes.css");
    expect(routes).toContain("@media(min-width:768px) and (max-width:1099px) { .public-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }");
    expect(routes).not.toContain("@media(min-width:768px) and (max-width:1023px) { .public-grid");
  });
});
