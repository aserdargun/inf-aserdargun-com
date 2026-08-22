import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";

const cspPlaceholder = "__INF_CSP_SCRIPT_HASHES__";
const workerPlaceholder = "__INF_PUBLIC_CACHE_VERSION__";
const invalidArtifactCases: Array<[string, "placeholder" | "unhashed" | "worker-placeholder" | "worker-mismatch", RegExp]> = [
  ["stale CSP placeholder", "placeholder", /stale CSP hash placeholder/i],
  ["unhashed inline script", "unhashed", /script-src/i],
  ["stale service-worker placeholder", "worker-placeholder", /stale service-worker release placeholder/i],
  ["service-worker release mismatch", "worker-mismatch", /service worker release/i],
];

function writeCompleteArtifact(directory: string, mode: "valid" | "placeholder" | "unhashed" | "worker-placeholder" | "worker-mismatch" = "valid") {
  const hydrationScript = "globalThis.__fixture=true;";
  const hash = `'sha256-${createHash("sha256").update(hydrationScript).digest("base64")}'`;
  const sourceConfig = readFileSync("public/staticwebapp.config.json", "utf8");
  const generatedConfig = mode === "placeholder" ? sourceConfig : sourceConfig.replace(cspPlaceholder, hash);
  const html = `<!doctype html><html><body><script>${hydrationScript}</script>${mode === "unhashed" ? "<script>globalThis.__unhashed=true;</script>" : ""}</body></html>`;
  const artifacts: Record<string, string> = {
    "out/index.html": html,
    "out/view/index.html": html,
    "out/staticwebapp.config.json": generatedConfig,
    "out/manifest.webmanifest": "{}",
    "out/view/sw.js": `const VERSION = "${workerPlaceholder}";`,
    "out/theme-bootstrap.js": "globalThis.__theme=true;",
    "out/icons/icon-192.png": "icon",
    "out/icons/icon-512.png": "icon",
    "out/icons/maskable-512.png": "icon",
    "out/_next/static/chunks/app.js": "globalThis.__app=true;",
    "api-dist/host.json": "{}",
    "api-dist/package.json": "{}",
    "api-dist/dist/index.js": "export {};",
    "api-dist/node_modules/@azure/functions/package.json": "{}",
    "api-dist/node_modules/@inf/contracts/package.json": "{}",
    "api-dist/node_modules/@inf/domain/package.json": "{}",
    "api-dist/node_modules/googleapis/package.json": "{}",
    "api-dist/node_modules/sharp/package.json": "{}",
    "api-dist/node_modules/zod/package.json": "{}",
  };
  for (const [artifact, contents] of Object.entries(artifacts)) {
    const target = join(directory, artifact);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, contents);
  }
  const moduleUrl = pathToFileURL(resolve("scripts/static-security-contract.mjs")).href;
  const release = spawnSync(process.execPath, ["--input-type=module", "-e", `import { generatePublicViewServiceWorker } from ${JSON.stringify(moduleUrl)}; await generatePublicViewServiceWorker({ outputRoot: "out" });`], {
    cwd: directory,
    encoding: "utf8",
  });
  if (release.status !== 0) throw new Error(release.stderr);
  if (mode === "worker-placeholder") writeFileSync(join(directory, "out/view/sw.js"), `const VERSION = "${workerPlaceholder}";`);
  if (mode === "worker-mismatch") writeFileSync(join(directory, "out/theme-bootstrap.js"), "globalThis.__theme='changed';");
}

describe("project contract", () => {
  test("evaluates to a static Next export", async () => {
    const nextConfig = await import(pathToFileURL("next.config.ts").href);

    expect(nextConfig.default.output).toBe("export");
    expect(nextConfig.default.trailingSlash).toBe(true);
    expect(nextConfig.default.images?.unoptimized).toBe(true);
    expect(await nextConfig.default.generateBuildId?.()).toBe("inf-static-release");

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

    try {
      writeCompleteArtifact(directory);

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

  test("rejects a runtime package exposed only through a symbolic link", () => {
    const directory = mkdtempSync(join(tmpdir(), "inf-artifacts-"));

    try {
      writeCompleteArtifact(directory);
      const functionsPackage = join(directory, "api-dist/node_modules/@azure/functions");
      const linkTarget = join(directory, "linked-functions-package");
      rmSync(functionsPackage, { force: true, recursive: true });
      mkdirSync(linkTarget, { recursive: true });
      writeFileSync(join(linkTarget, "package.json"), "{}");
      symlinkSync(linkTarget, functionsPackage, "dir");

      const result = spawnSync(process.execPath, [resolve("scripts/verify-artifacts.mjs")], {
        cwd: directory,
        encoding: "utf8"
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/physical directory|symbolic link/i);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test.each(invalidArtifactCases)("rejects an artifact with a %s", (_label, mode, error) => {
    const directory = mkdtempSync(join(tmpdir(), "inf-artifacts-"));
    try {
      writeCompleteArtifact(directory, mode);
      const result = spawnSync(process.execPath, [resolve("scripts/verify-artifacts.mjs")], {
        cwd: directory,
        encoding: "utf8"
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(error);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
