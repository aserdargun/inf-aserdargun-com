import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertStaticSecurityConfig, inlineScriptHashes as scanInlineScriptHashes } from "../scripts/static-security-contract.mjs";
import * as securityContract from "../scripts/static-security-contract.mjs";

const placeholder = "__INF_CSP_SCRIPT_HASHES__";
const securityHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function cspHash(body) {
  return `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
}

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
  assert.equal(cacheByRoute.get("/favicon.svg"), "public, max-age=86400, must-revalidate");
  assert.equal(cacheByRoute.get("/favicon.ico"), "public, max-age=86400, must-revalidate");
  assert.equal(cacheByRoute.get("/_next/static/*"), "public, max-age=31536000, immutable");

  const artifact = JSON.parse(await readFile("out/staticwebapp.config.json", "utf8"));
  assert.equal(JSON.stringify(artifact).includes(placeholder), false);
  const hashes = await inlineScriptHashes("out");
  assert.ok(hashes.length > 0);
  assertCsp(artifact.globalHeaders["Content-Security-Policy"], hashes);
  assert.deepEqual(artifact.routes, source.routes);
});

test("CSP rejects script directive overrides and every unknown directive", async () => {
  const source = JSON.parse(await readFile("public/staticwebapp.config.json", "utf8"));
  const mutate = (suffix) => {
    const config = globalThis.structuredClone(source);
    config.globalHeaders["Content-Security-Policy"] += `; ${suffix}`;
    return config;
  };
  assert.throws(() => assertStaticSecurityConfig(mutate("script-src-elem 'unsafe-inline'"), [placeholder]), /script-src-elem|directive/i);
  assert.throws(() => assertStaticSecurityConfig(mutate("script-src-attr 'unsafe-inline'"), [placeholder]), /script-src-attr|directive/i);
  assert.throws(() => assertStaticSecurityConfig(mutate("child-src 'self'"), [placeholder]), /child-src|directive/i);
});

test("HTML scanner hashes executable bodies unless a real src attribute exists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inf-csp-attributes-"));
  try {
    await writeFile(join(directory, "index.html"), [
      "<!doctype html>",
      "<script>baseline</script>",
      '<script data-src="decoy">danger</script>',
      "<script x-src='decoy'>x-source</script>",
      '<script srcdoc="ignored-as-an-attribute">srcdoc-body</script>',
      "<script DATA-SRC = decoy defer>mixed-case</script>",
      '<script data-note="src=decoy">quoted-src-text</script>',
      '<script src="/external.js"></script>',
      '<script SRC = /external-two.js async>   </script>',
    ].join(""));
    assert.deepEqual(await scanInlineScriptHashes(directory), [
      "'sha256-6hI6n99pxkuccm/Jf/8cHsrHK8vNYnLKWxCWUzOZeI4='",
      "'sha256-Ej/WZqo503ZpDPplcEJtNYXBiLKRvIes9HuE4/6CIQI='",
      "'sha256-i6hJaiUlrhcf/RBNYy3t5u9BjZuVliqdiOL828jUjSQ='",
      "'sha256-mU5J+uioQBAu9L4+9YDUpyaee4bAyH3XXbKVzmKjYaY='",
      "'sha256-mdVnSuhV7Bql9WQdpfDOp/3wvHrOVIxS//60zhjM984='",
      "'sha256-wiaXfHqvodPZ428JphUNqO51/uWTJlr3gmzsJZdPWFI='",
    ]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("HTML scanner rejects external script tags with executable inline bodies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inf-csp-ambiguous-"));
  try {
    await writeFile(join(directory, "index.html"), '<!doctype html><script>baseline</script><script src="/external.js">inline-body</script>');
    await assert.rejects(() => scanInlineScriptHashes(directory), /external.*inline|inline.*external|ambiguous/i);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("HTML scanner hashes only executable document scripts, excluding comments and template contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inf-csp-document-tree-"));
  try {
    await writeFile(join(directory, "index.html"), [
      "<!doctype html>",
      "<script>baseline</script>",
      "<!-- <script>comment-only</script> -->",
      "<template><script>template-only</script></template>",
    ].join(""));
    assert.deepEqual(await scanInlineScriptHashes(directory), [cspHash("baseline")]);

    await writeFile(join(directory, "index.html"), [
      "<!doctype html>",
      "<script>baseline</script>",
      "<script>comment-only</script>",
      "<template><script>template-only</script></template>",
    ].join(""));
    assert.deepEqual(await scanInlineScriptHashes(directory), [cspHash("baseline"), cspHash("comment-only")].sort());
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("HTML scanner rejects non-root-relative external script sources", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inf-csp-external-origin-"));
  try {
    await writeFile(join(directory, "index.html"), '<!doctype html><script>baseline</script><script src="https://attacker.example/payload.js"></script>');
    await assert.rejects(() => scanInlineScriptHashes(directory), /external|same-origin|root-relative|src/i);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("HTML scanner hashes only CSP-governed executable script types", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inf-csp-script-types-"));
  try {
    await writeFile(join(directory, "index.html"), [
      "<!doctype html>",
      "<script>classic-body</script>",
      '<script type="module">module-body</script>',
      '<script type="text/javascript">exact-mime-body</script>',
      '<script type=" \ttext/javascript\r\n ">ascii-whitespace-mime-body</script>',
      '<script type="text/javascript; charset=utf-8">parameterized-mime-body</script>',
      '<script type="\u00a0text/javascript\u00a0">nbsp-mime-body</script>',
      '<script type="\ufefftext/javascript\ufeff">bom-mime-body</script>',
      '<script type="application/json">json-body</script>',
      '<script type="text/plain">plain-body</script>',
      "<script nomodule>nomodule-body</script>",
    ].join(""));
    const inert = await scanInlineScriptHashes(directory);
    assert.deepEqual(inert, [cspHash("ascii-whitespace-mime-body"), cspHash("classic-body"), cspHash("exact-mime-body"), cspHash("module-body")].sort());

    await writeFile(join(directory, "index.html"), [
      "<!doctype html>",
      "<script>classic-body</script>",
      '<script type="module">module-body</script>',
      '<script type="text/javascript">exact-mime-body</script>',
      '<script type="text/javascript">ascii-whitespace-mime-body</script>',
      '<script type="text/javascript">parameterized-mime-body</script>',
      '<script type="text/javascript">nbsp-mime-body</script>',
      '<script type="text/javascript">bom-mime-body</script>',
      "<script>json-body</script>",
      "<script>plain-body</script>",
      "<script>nomodule-body</script>",
    ].join(""));
    const executable = await scanInlineScriptHashes(directory);
    assert.notDeepEqual(executable, inert);
    assert.deepEqual(executable, ["ascii-whitespace-mime-body", "bom-mime-body", "classic-body", "exact-mime-body", "json-body", "module-body", "nomodule-body", "nbsp-mime-body", "parameterized-mime-body", "plain-body"].map(cspHash).sort());
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("service-worker release is deterministic and changes with every View release input", async () => {
  assert.equal(typeof securityContract.generatePublicViewServiceWorker, "function");
  const directory = await mkdtemp(join(tmpdir(), "inf-worker-release-"));
  const files = new Map([
    ["view/index.html", "view-v1"],
    ["view/sw.js", 'const VERSION = "__INF_PUBLIC_CACHE_VERSION__";'],
    ["staticwebapp.config.json", "security-v1"],
    ["theme-bootstrap.js", "theme-v1"],
    ["manifest.webmanifest", "manifest-v1"],
    ["icons/icon-192.png", "icon-192"],
    ["icons/icon-512.png", "icon-512"],
    ["icons/maskable-512.png", "icon-maskable"],
    ["_next/static/chunks/app.js", "runtime-v1"],
  ]);
  try {
    for (const [path, contents] of files) {
      const target = join(directory, path);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, contents);
    }
    const first = await securityContract.generatePublicViewServiceWorker({ outputRoot: directory });
    assert.match(first.version, /^INF-PUBLIC-[a-f0-9]{64}$/);
    assert.equal(first.version, `INF-PUBLIC-${first.digest}`);
    assert.deepEqual(first.inputs, [
      "_next/static/chunks/app.js",
      "icons/icon-192.png",
      "icons/icon-512.png",
      "icons/maskable-512.png",
      "manifest.webmanifest",
      "staticwebapp.config.json",
      "theme-bootstrap.js",
      "view/index.html",
    ]);
    assert.doesNotMatch(await readFile(join(directory, "view/sw.js"), "utf8"), /__INF_PUBLIC_CACHE_VERSION__/);
    assert.equal((await securityContract.generatePublicViewServiceWorker({ outputRoot: directory })).version, first.version);
    await writeFile(join(directory, "view/index.html"), "view-v2");
    const shellMutation = await securityContract.generatePublicViewServiceWorker({ outputRoot: directory });
    assert.notEqual(shellMutation.version, first.version);
    await writeFile(join(directory, "view/index.html"), "view-v1");
    await writeFile(join(directory, "_next/static/chunks/app.js"), "runtime-v2");
    const runtimeMutation = await securityContract.generatePublicViewServiceWorker({ outputRoot: directory });
    assert.notEqual(runtimeMutation.version, first.version);
    await writeFile(join(directory, "_next/static/chunks/app.js"), "runtime-v1");
    const restored = await securityContract.generatePublicViewServiceWorker({ outputRoot: directory });
    assert.equal(restored.version, first.version);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("deployed worker release covers the real View shell and every referenced Next static asset", async () => {
  assert.equal(typeof securityContract.publicViewRelease, "function");
  const release = await securityContract.publicViewRelease({ outputRoot: "out" });
  assert.ok(release.inputs.includes("view/index.html"));
  assert.ok(release.inputs.includes("staticwebapp.config.json"));
  const html = await readFile("out/view/index.html", "utf8");
  const references = [...new Set([...html.matchAll(/\/_next\/static\/[^"'\\]+/g)].map((match) => match[0].slice(1)))];
  assert.ok(references.length > 0);
  for (const reference of references) assert.ok(release.inputs.includes(reference), reference);
});
