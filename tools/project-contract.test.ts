import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";

describe("project contract", () => {
  test("evaluates to a static Next export and emits static host artifacts", async () => {
    const nextConfig = await import(pathToFileURL("next.config.ts").href);

    expect(nextConfig.default.output).toBe("export");
    expect(nextConfig.default.trailingSlash).toBe(true);
    expect(nextConfig.default.images?.unoptimized).toBe(true);

    execFileSync("pnpm", ["exec", "next", "build"], { stdio: "inherit" });

    accessSync("out/index.html", constants.R_OK);
    accessSync("out/staticwebapp.config.json", constants.R_OK);
    accessSync("out/manifest.webmanifest", constants.R_OK);
  }, 30_000);

  test("keeps public routes before the authenticated catch-all", () => {
    const swa = JSON.parse(readFileSync("public/staticwebapp.config.json", "utf8"));
    const publicIndex = swa.routes.findIndex((route: { route: string }) => route.route === "/view*");
    const privateIndex = swa.routes.findIndex((route: { route: string }) => route.route === "/*");
    const publicViewRoute = swa.routes.find((route: { route: string }) => route.route === "/view*");
    const publicViewChildRoute = swa.routes.find((route: { route: string }) => route.route === "/view/*");
    const privateInfographicRoute = swa.routes.find((route: { route: string }) => route.route === "/infographic/*");

    expect(publicIndex).toBeGreaterThanOrEqual(0);
    expect(privateIndex).toBeGreaterThan(publicIndex);
    expect(publicViewRoute).toMatchObject({
      allowedRoles: ["anonymous"],
      rewrite: "/view/index.html"
    });
    expect(publicViewChildRoute).toMatchObject({
      allowedRoles: ["anonymous"],
      rewrite: "/view/index.html"
    });
    expect(privateInfographicRoute).toMatchObject({
      allowedRoles: ["authenticated"],
      rewrite: "/infographic/index.html"
    });
    expect(swa.platform.apiRuntime).toBe("node:22");
    expect(swa.responseOverrides["401"].redirect).toBe("/login");
  });

  test("rejects an incomplete artifact directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "inf-artifacts-"));

    try {
      const result = spawnSync(process.execPath, [resolve("scripts/verify-artifacts.mjs")], {
        cwd: directory,
        encoding: "utf8"
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Missing required artifact: out/index.html");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("accepts a complete artifact directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "inf-artifacts-"));
    const artifacts = [
      "out/index.html",
      "out/staticwebapp.config.json",
      "out/manifest.webmanifest",
      "api-dist/host.json",
      "api-dist/package.json"
    ];

    try {
      for (const artifact of artifacts) {
        const target = join(directory, artifact);
        mkdirSync(resolve(target, ".."), { recursive: true });
        writeFileSync(target, "");
      }

      const result = spawnSync(process.execPath, [resolve("scripts/verify-artifacts.mjs")], {
        cwd: directory,
        encoding: "utf8"
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Artifacts verified.");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
