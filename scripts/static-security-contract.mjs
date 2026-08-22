import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parse } from "parse5";

export const CSP_HASH_PLACEHOLDER = "__INF_CSP_SCRIPT_HASHES__";
export const SERVICE_WORKER_VERSION_PLACEHOLDER = "__INF_PUBLIC_CACHE_VERSION__";

const viewReleaseFixedInputs = [
  "view/index.html",
  "staticwebapp.config.json",
  "theme-bootstrap.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
];

const requiredHeaders = Object.freeze({
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

const cacheByRoute = new Map([
  ["/view/sw.js", "public, max-age=0, must-revalidate"],
  ["/view/*", "public, max-age=0, must-revalidate"],
  ["/view*", "public, max-age=0, must-revalidate"],
  ["/api/public/*", "public, max-age=60, stale-while-revalidate=300"],
  ["/_next/static/*", "public, max-age=31536000, immutable"],
  ["/manifest.webmanifest", "public, max-age=300, must-revalidate"],
  ["/theme-bootstrap.js", "public, max-age=300, must-revalidate"],
  ["/icons/*", "public, max-age=86400, must-revalidate"],
  ["/favicon.ico", "public, max-age=86400, must-revalidate"],
]);

const classicJavaScriptMimeTypes = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

function requirePolicy(condition, message) {
  if (!condition) throw new Error(`Static security policy invalid: ${message}`);
}

function cspDirectives(policy) {
  requirePolicy(typeof policy === "string" && policy.length > 0, "Content-Security-Policy is missing");
  const directives = new Map();
  for (const raw of policy.split(";")) {
    const directive = raw.trim();
    if (!directive) continue;
    const [name, ...values] = directive.split(/\s+/);
    requirePolicy(!directives.has(name), `duplicate CSP directive ${name}`);
    directives.set(name, values);
  }
  return directives;
}

function exactDirective(directives, name, expected) {
  requirePolicy(JSON.stringify(directives.get(name)) === JSON.stringify(expected), `${name} must be exactly ${expected.join(" ")}`);
}

function scriptElements(html, path) {
  const parseErrors = [];
  const document = parse(html, { onParseError: (error) => parseErrors.push(error) });
  requirePolicy(parseErrors.length === 0, `${path} contains malformed HTML (${parseErrors[0]?.code ?? "parse error"})`);
  const elements = [];
  const visit = (node) => {
    if (node?.tagName === "template") return;
    if (node?.tagName === "script") {
      const attributes = new Map((node.attrs ?? []).map((attribute) => [attribute.name.toLowerCase(), attribute.value]));
      const body = (node.childNodes ?? []).filter((child) => child.nodeName === "#text").map((child) => child.value ?? "").join("");
      elements.push({ attributes, body });
    }
    for (const child of node?.childNodes ?? []) visit(child);
  };
  visit(document);
  return elements;
}

function isCspGovernedExecutableScript(attributes) {
  const type = (attributes.get("type") ?? "").trim().toLowerCase();
  if (type === "module" || type === "importmap" || type === "speculationrules") return true;
  const classic = type === "" || classicJavaScriptMimeTypes.has(type);
  return classic && !attributes.has("nomodule");
}

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

export async function publicViewRelease({ outputRoot = "out" } = {}) {
  const root = resolve(outputRoot);
  const nextStaticFiles = await filesUnder(resolve(root, "_next/static"));
  const inputs = [...viewReleaseFixedInputs, ...nextStaticFiles.map((path) => relative(root, path).split("\\").join("/"))].sort();
  const hash = createHash("sha256");
  for (const path of inputs) {
    const bytes = await readFile(resolve(root, path));
    hash.update(path);
    hash.update("\0");
    hash.update(String(bytes.length));
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  const digest = hash.digest("hex");
  return { digest, inputs, version: `INF-PUBLIC-${digest}` };
}

export async function generatePublicViewServiceWorker({ outputRoot = "out" } = {}) {
  const root = resolve(outputRoot);
  const release = await publicViewRelease({ outputRoot: root });
  const workerPath = resolve(root, "view/sw.js");
  const source = await readFile(workerPath, "utf8");
  const versionPattern = /const VERSION = "(__INF_PUBLIC_CACHE_VERSION__|INF-PUBLIC-[a-f0-9]{64})";/g;
  const matches = [...source.matchAll(versionPattern)];
  requirePolicy(matches.length === 1, "service worker must contain exactly one replaceable release version");
  const generated = source.replace(versionPattern, `const VERSION = "${release.version}";`);
  requirePolicy(!generated.includes(SERVICE_WORKER_VERSION_PLACEHOLDER), "generated service worker retains a stale release placeholder");
  await writeFile(workerPath, generated);
  return release;
}

export async function assertPublicViewServiceWorker({ outputRoot = "out" } = {}) {
  const root = resolve(outputRoot);
  const release = await publicViewRelease({ outputRoot: root });
  const source = await readFile(resolve(root, "view/sw.js"), "utf8");
  requirePolicy(!source.includes(SERVICE_WORKER_VERSION_PLACEHOLDER), "generated service worker retains a stale release placeholder");
  requirePolicy(source.includes(`const VERSION = "${release.version}";`), "service worker release does not match its View inputs");
  return release;
}

export async function inlineScriptHashes(outputRoot) {
  const hashes = new Set();
  const files = (await filesUnder(resolve(outputRoot))).filter((path) => path.endsWith(".html"));
  requirePolicy(files.length > 0, "generated export has no HTML files");
  for (const path of files) {
    const html = await readFile(path, "utf8");
    for (const element of scriptElements(html, path)) {
      const source = element.attributes.get("src");
      if (source !== undefined) {
        requirePolicy(source.startsWith("/") && !source.startsWith("//") && !source.includes("\\"), `${path} has a non-root-relative external script src`);
        requirePolicy(element.body.trim() === "", `${path} has an ambiguous external script with an inline body`);
        continue;
      }
      if (!isCspGovernedExecutableScript(element.attributes)) continue;
      if (element.body.trim() !== "") hashes.add(`'sha256-${createHash("sha256").update(element.body).digest("base64")}'`);
    }
  }
  requirePolicy(hashes.size > 0, "generated export has no inline Next hydration scripts to pin");
  return [...hashes].sort();
}

export function assertStaticSecurityConfig(config, expectedScriptSources) {
  requirePolicy(config && typeof config === "object" && !Array.isArray(config), "config must be an object");
  requirePolicy(config.globalHeaders && typeof config.globalHeaders === "object", "globalHeaders are missing");
  for (const [name, value] of Object.entries(requiredHeaders)) requirePolicy(config.globalHeaders[name] === value, `${name} must be ${value}`);
  const directives = cspDirectives(config.globalHeaders["Content-Security-Policy"]);
  const expectedNames = ["default-src", "base-uri", "connect-src", "font-src", "form-action", "frame-ancestors", "img-src", "manifest-src", "object-src", "script-src", "script-src-attr", "style-src", "worker-src"];
  requirePolicy(JSON.stringify([...directives.keys()]) === JSON.stringify(expectedNames), `CSP directives must be exactly ${expectedNames.join(", ")}`);
  exactDirective(directives, "default-src", ["'self'"]);
  exactDirective(directives, "base-uri", ["'self'"]);
  exactDirective(directives, "connect-src", ["'self'"]);
  exactDirective(directives, "font-src", ["'self'", "data:"]);
  exactDirective(directives, "form-action", ["'self'"]);
  exactDirective(directives, "frame-ancestors", ["'none'"]);
  exactDirective(directives, "img-src", ["'self'", "data:", "blob:"]);
  exactDirective(directives, "manifest-src", ["'self'"]);
  exactDirective(directives, "object-src", ["'none'"]);
  exactDirective(directives, "style-src", ["'self'", "'unsafe-inline'"]);
  exactDirective(directives, "worker-src", ["'self'"]);
  exactDirective(directives, "script-src", ["'self'", ...expectedScriptSources]);
  exactDirective(directives, "script-src-attr", ["'none'"]);
  const scripts = directives.get("script-src").join(" ");
  requirePolicy(!/unsafe-inline|unsafe-eval|\*|https?:/i.test(scripts), "script-src must not allow inline/eval/wildcard/remote scripts");
  for (const values of directives.values()) requirePolicy(!values.some((value) => value === "*" || /^https?:/i.test(value)), "CSP must not allow wildcard or remote origins");
  requirePolicy(Array.isArray(config.routes), "routes are missing");
  for (const [routeName, cache] of cacheByRoute) {
    const route = config.routes.find((candidate) => candidate?.route === routeName);
    requirePolicy(route?.headers?.["Cache-Control"] === cache, `${routeName} cache policy must be ${cache}`);
  }
  return config;
}

function routeMatches(pattern, pathname) {
  if (pattern.endsWith("*")) return pathname.startsWith(pattern.slice(0, -1));
  return pathname === pattern;
}

export function headersForPath(config, pathname) {
  const headers = { ...config.globalHeaders };
  const route = config.routes.find((candidate) => typeof candidate?.route === "string" && routeMatches(candidate.route, pathname));
  Object.assign(headers, route?.headers ?? {});
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
}

export function rewrittenPathFor(config, pathname) {
  const route = config.routes.find((candidate) => typeof candidate?.route === "string" && routeMatches(candidate.route, pathname));
  return typeof route?.rewrite === "string" ? route.rewrite : pathname;
}

export async function generateStaticSecurityConfig({ sourcePath = "public/staticwebapp.config.json", outputRoot = "out" } = {}) {
  const source = JSON.parse(await readFile(resolve(sourcePath), "utf8"));
  assertStaticSecurityConfig(source, [CSP_HASH_PLACEHOLDER]);
  const hashes = await inlineScriptHashes(outputRoot);
  const policy = source.globalHeaders["Content-Security-Policy"];
  requirePolicy(policy.split(CSP_HASH_PLACEHOLDER).length === 2, "CSP hash placeholder must appear exactly once");
  const generated = globalThis.structuredClone(source);
  generated.globalHeaders["Content-Security-Policy"] = policy.replace(CSP_HASH_PLACEHOLDER, hashes.join(" "));
  assertStaticSecurityConfig(generated, hashes);
  const serialized = `${JSON.stringify(generated, null, 2)}\n`;
  requirePolicy(!serialized.includes(CSP_HASH_PLACEHOLDER), "generated config retains a stale CSP placeholder");
  await writeFile(resolve(outputRoot, "staticwebapp.config.json"), serialized);
  const release = await generatePublicViewServiceWorker({ outputRoot });
  return { config: generated, hashes, release };
}
