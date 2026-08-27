import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();
const icon = (name: string) => readFileSync(resolve(root, "public/icons", name));
const sharp = createRequire(resolve(root, "api/package.json"))("sharp");

function pngDimensions(bytes: Buffer) {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("public PWA contract", () => {
  test("publishes the Infographics product name for installation", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "public/manifest.webmanifest"), "utf8"));
    expect(manifest.name).toBe("Infographics");
    expect(manifest.short_name).toBe("Infographics");
  });

  test("ships a local SVG favicon that stays legible at browser-tab size", async () => {
    const faviconPath = resolve(root, "public/favicon.svg");
    expect(existsSync(faviconPath)).toBe(true);
    const { data, info } = await sharp(faviconPath).resize(16, 16).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 16, height: 16, channels: 4 });
    let bluePixels = 0;
    let whitePixels = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      const [red, green, blue, alpha] = data.subarray(offset, offset + 4);
      if (alpha > 192 && blue > red * 1.4 && blue > green * 1.15) bluePixels += 1;
      if (alpha > 192 && red > 224 && green > 224 && blue > 224) whitePixels += 1;
    }
    expect(bluePixels).toBeGreaterThan(80);
    expect(whitePixels).toBeGreaterThan(12);
  });

  test("ships exactly the local install icons with valid PNG dimensions", async () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "public/manifest.webmanifest"), "utf8"));
    expect(manifest).toMatchObject({ display: "standalone", start_url: "/view/", scope: "/view/", theme_color: "#ffffff", background_color: "#ffffff" });
    expect(manifest.icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-192.webp", sizes: "192x192", type: "image/webp" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.webp", sizes: "512x512", type: "image/webp" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.webp", sizes: "512x512", type: "image/webp", purpose: "maskable" },
    ]);
    const swa = readFileSync(resolve(root, "public/staticwebapp.config.json"), "utf8");
    expect(swa).toContain('"route": "/icons/*"');
    expect(pngDimensions(icon("icon-192.png"))).toEqual({ width: 192, height: 192 });
    expect(pngDimensions(icon("icon-512.png"))).toEqual({ width: 512, height: 512 });
    expect(pngDimensions(icon("maskable-512.png"))).toEqual({ width: 512, height: 512 });
    expect(icon("icon-512.png").equals(icon("maskable-512.png"))).toBe(false);
    const { data, info } = await sharp(icon("maskable-512.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 512, height: 512, channels: 4 });
    const at = (x: number, y: number) => data[(y * 512 + x) * 4];
    expect([at(0, 0), at(511, 0), at(0, 511), at(511, 511)]).toEqual([40, 40, 40, 40]);
    let transparentPixel: { x: number; y: number; alpha: number } | undefined;
    let unsafeArtworkPixel: { x: number; y: number } | undefined;
    for (let y = 0; y < 512; y += 1) for (let x = 0; x < 512; x += 1) {
      const offset = (y * 512 + x) * 4;
      if (!transparentPixel && data[offset + 3] !== 255) transparentPixel = { x, y, alpha: data[offset + 3] };
      const isBackground = data[offset] === 40 && data[offset + 1] === 100 && data[offset + 2] === 220;
      if (!unsafeArtworkPixel && !isBackground && (x < 52 || x > 460 || y < 52 || y > 460)) unsafeArtworkPixel = { x, y };
    }
    expect(transparentPixel).toBeUndefined();
    expect(unsafeArtworkPixel).toBeUndefined();
  });

  test("has a bounded public-only service worker policy", () => {
    const serviceWorker = readFileSync(resolve(root, "public/view/sw.js"), "utf8");
    const deployedWorker = readFileSync(resolve(root, "out/view/sw.js"), "utf8");
    expect(serviceWorker).toContain("__INF_PUBLIC_CACHE_VERSION__");
    expect(deployedWorker).toMatch(/const VERSION = "INF-PUBLIC-[a-f0-9]{64}"/);
    expect(deployedWorker).not.toContain("__INF_PUBLIC_CACHE_VERSION__");
    expect(serviceWorker).toContain("request.method !== \"GET\"");
    expect(serviceWorker).toContain("url.origin !== self.location.origin");
    expect(serviceWorker).toContain("/api/public/infographics");
    expect(serviceWorker).toContain("/api/public/images/");
    expect(serviceWorker).toContain("response.ok");
    expect(serviceWorker).toContain("MAX_ENTRIES");
    expect(serviceWorker).not.toContain("/api/infographics");
  });

  test("links PWA metadata and confines registration to the public shell", () => {
    const layout = readFileSync(resolve(root, "app/layout.tsx"), "utf8");
    const themeBootstrap = readFileSync(resolve(root, "public/theme-bootstrap.js"), "utf8");
    const registration = readFileSync(resolve(root, "features/pwa/service-worker-registration.tsx"), "utf8");
    expect(layout).toContain('manifest: "/manifest.webmanifest"');
    // theme-bootstrap.js is loaded as a non-blocking preload + async script so
    // the first paint is not gated on theme resolution. CSP hash coverage
    // still applies because the inline preload declares the resource.
    expect(layout).toMatch(/<link[^>]+rel="preload"[^>]+href="\/theme-bootstrap\.js"/);
    expect(layout).toMatch(/<script[^>]+async[^>]+src="\/theme-bootstrap\.js"/);
    expect(layout).not.toContain("dangerouslySetInnerHTML");
    expect(themeBootstrap).toContain('localStorage.getItem("inf-theme")');
    const shell = readFileSync(resolve(root, "components/public-shell.tsx"), "utf8");
    expect(layout).not.toContain("ServiceWorkerRegistration");
    expect(shell).toContain("ServiceWorkerRegistration");
    expect(registration).toContain("serviceWorker");
    expect(registration).toContain("localhost");
    expect(registration).toContain('register("/view/sw.js", { scope: "/view/" })');
  });

  test("publishes a non-rewritten anonymous View worker before the View shell rewrite", () => {
    const swa = JSON.parse(readFileSync(resolve(root, "public/staticwebapp.config.json"), "utf8"));
    const workerIndex = swa.routes.findIndex((route: { route: string }) => route.route === "/view/sw.js");
    const shellIndex = swa.routes.findIndex((route: { route: string }) => route.route === "/view/*");
    expect(workerIndex).toBeGreaterThanOrEqual(0); expect(workerIndex).toBeLessThan(shellIndex);
    expect(swa.routes[workerIndex]).toEqual({
      route: "/view/sw.js",
      allowedRoles: ["anonymous"],
      headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
    });
    const worker = readFileSync(resolve(root, "out/view/sw.js"), "utf8");
    expect(worker).toContain("self.addEventListener");
    expect(worker).not.toContain("<html");
  });

  test("public features stay inside the public contract boundary", () => {
    const publicFeatures = ["public-gallery.tsx", "public-detail.tsx", "public-view-route.tsx"].map((file) => readFileSync(resolve(root, "features/public-view", file), "utf8")).join("\n");
    const publicContract = readFileSync(resolve(root, "packages/contracts/src/public.ts"), "utf8");
    const manifest = JSON.parse(readFileSync(resolve(root, "packages/contracts/package.json"), "utf8"));
    expect(publicFeatures).toContain("/api/public/");
    expect(publicFeatures).toContain('from "@inf/contracts/public"');
    expect(publicFeatures).not.toContain('from "@inf/contracts"');
    expect(publicFeatures).not.toMatch(/features\/(library|detail|review|settings)|OwnerCatalog|MaterializedInfographic|sourceUrl|categoryIds|tagIds|favorite|seenCount|reviewCount|folderState|sha256/i);
    expect(publicContract).not.toMatch(/from "\.\/entities"|from "\.\/api"|sourceUrl|originalDriveFileId|categoryIds|folderState/);
    expect(manifest.exports["./public"]).toEqual({ types: "./src/public.ts", default: "./dist/public.js" });
  });

  test("keeps owner schema tokens out of the production View chunk graph", () => {
    const html = readFileSync(resolve(root, "out/view/index.html"), "utf8");
    const scripts = [...html.matchAll(/\/_next\/static\/chunks\/[^"\\]+\.js/g)].map((match) => match[0]);
    expect(scripts.length).toBeGreaterThan(0);
    const viewBundle = [...new Set(scripts)].map((file) => readFileSync(resolve(root, "out", file.slice(1)), "utf8")).join("\n");
    expect(viewBundle).not.toMatch(/sourceUrl|originalDriveFileId|thumbnailDriveFileId|categoryIds|tagIds|folderState|reviewCount/);
  });
});
