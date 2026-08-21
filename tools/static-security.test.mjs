import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const placeholder = "__INF_CSP_SCRIPT_HASHES__";
const securityHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(path);
  }
  return files.sort();
}

async function inlineScriptHashes(directory) {
  const hashes = new Set();
  for (const path of await htmlFiles(directory)) {
    const html = await readFile(path, "utf8");
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/i.test(match[1])) continue;
      hashes.add(`'sha256-${createHash("sha256").update(match[2]).digest("base64")}'`);
    }
  }
  return [...hashes].sort();
}

function directives(csp) {
  return new Map(csp.split(";").map((directive) => directive.trim()).filter(Boolean).map((directive) => {
    const [name, ...values] = directive.split(/\s+/);
    return [name, values];
  }));
}

function assertCsp(csp, expectedHashes) {
  const parsed = directives(csp);
  assert.deepEqual(parsed.get("default-src"), ["'self'"]);
  assert.deepEqual(parsed.get("base-uri"), ["'self'"]);
  assert.deepEqual(parsed.get("connect-src"), ["'self'"]);
  assert.deepEqual(parsed.get("form-action"), ["'self'"]);
  assert.deepEqual(parsed.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(parsed.get("object-src"), ["'none'"]);
  assert.deepEqual(parsed.get("worker-src"), ["'self'"]);
  const scripts = parsed.get("script-src") ?? [];
  assert.equal(scripts[0], "'self'");
  assert.deepEqual(scripts.slice(1).sort(), expectedHashes);
  assert.doesNotMatch(scripts.join(" "), /unsafe-inline|unsafe-eval|\*|https?:/i);
  assert.doesNotMatch(csp, /unsafe-eval|\*|https?:|stale-placeholder/i);
}

test("source and generated static configs enforce CSP, security headers, and intentional cache classes", async () => {
  const source = JSON.parse(await readFile("public/staticwebapp.config.json", "utf8"));
  assert.deepEqual(Object.fromEntries(Object.entries(source.globalHeaders).filter(([name]) => name !== "Content-Security-Policy")), securityHeaders);
  assertCsp(source.globalHeaders["Content-Security-Policy"], [placeholder]);
  const cacheByRoute = new Map(source.routes.map((route) => [route.route, route.headers?.["Cache-Control"]]));
  assert.equal(cacheByRoute.get("/view/sw.js"), "public, max-age=0, must-revalidate");
  assert.equal(cacheByRoute.get("/view/*"), "public, max-age=0, must-revalidate");
  assert.equal(cacheByRoute.get("/view*"), "public, max-age=0, must-revalidate");
  assert.equal(cacheByRoute.get("/manifest.webmanifest"), "public, max-age=300, must-revalidate");
  assert.equal(cacheByRoute.get("/icons/*"), "public, max-age=86400, must-revalidate");
  assert.equal(cacheByRoute.get("/favicon.ico"), "public, max-age=86400, must-revalidate");
  assert.equal(cacheByRoute.get("/_next/static/*"), "public, max-age=31536000, immutable");

  const artifact = JSON.parse(await readFile("out/staticwebapp.config.json", "utf8"));
  assert.equal(JSON.stringify(artifact).includes(placeholder), false);
  const hashes = await inlineScriptHashes("out");
  assert.ok(hashes.length > 0);
  assertCsp(artifact.globalHeaders["Content-Security-Policy"], hashes);
  assert.deepEqual(artifact.routes, source.routes);
});
