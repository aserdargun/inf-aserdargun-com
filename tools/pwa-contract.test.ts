import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();
const icon = (name: string) => readFileSync(resolve(root, "public/icons", name));

function pngDimensions(bytes: Buffer) {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("public PWA contract", () => {
  test("ships exactly the local install icons with valid PNG dimensions", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "public/manifest.webmanifest"), "utf8"));
    expect(manifest).toMatchObject({ display: "standalone", start_url: "/view/", scope: "/view/", theme_color: "#ffffff", background_color: "#ffffff" });
    expect(manifest.icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
    expect(pngDimensions(icon("icon-192.png"))).toEqual({ width: 192, height: 192 });
    expect(pngDimensions(icon("icon-512.png"))).toEqual({ width: 512, height: 512 });
    expect(pngDimensions(icon("maskable-512.png"))).toEqual({ width: 512, height: 512 });
  });

  test("has a bounded public-only service worker policy", () => {
    const serviceWorker = readFileSync(resolve(root, "public/sw.js"), "utf8");
    expect(serviceWorker).toContain("PUBLIC-CACHE-v1");
    expect(serviceWorker).toContain("request.method !== \"GET\"");
    expect(serviceWorker).toContain("url.origin !== self.location.origin");
    expect(serviceWorker).toContain("/api/public/infographics");
    expect(serviceWorker).toContain("/api/public/images/");
    expect(serviceWorker).toContain("response.ok");
    expect(serviceWorker).toContain("MAX_ENTRIES");
    expect(serviceWorker).not.toContain("/api/infographics");
  });

  test("links PWA metadata and only registers where service workers are supported", () => {
    const layout = readFileSync(resolve(root, "app/layout.tsx"), "utf8");
    const registration = readFileSync(resolve(root, "features/pwa/service-worker-registration.tsx"), "utf8");
    expect(layout).toContain('manifest: "/manifest.webmanifest"');
    expect(layout).toContain("ServiceWorkerRegistration");
    expect(registration).toContain("serviceWorker");
    expect(registration).toContain("localhost");
  });

  test("public features stay inside the public contract boundary", () => {
    const publicFeatures = ["public-gallery.tsx", "public-detail.tsx", "public-view-route.tsx"].map((file) => readFileSync(resolve(root, "features/public-view", file), "utf8")).join("\n");
    expect(publicFeatures).toContain("/api/public/");
    expect(publicFeatures).not.toMatch(/features\/(library|inbox|detail|review|settings)|OwnerCatalog|MaterializedInfographic|sourceUrl|categoryIds|tagIds|favorite|seenCount|reviewCount|folderState|sha256/i);
  });
});
