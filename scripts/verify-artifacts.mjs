import { constants } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { assertPublicViewServiceWorker, assertStaticSecurityConfig, CSP_HASH_PLACEHOLDER, inlineScriptHashes, SERVICE_WORKER_VERSION_PLACEHOLDER } from "./static-security-contract.mjs";

const required = [
  "out/index.html",
  "out/view/index.html",
  "out/staticwebapp.config.json",
  "out/manifest.webmanifest",
  "out/view/sw.js",
  "out/theme-bootstrap.js",
  "out/icons/icon-192.png",
  "out/icons/icon-512.png",
  "out/icons/maskable-512.png",
  "api-dist/host.json",
  "api-dist/package.json",
];

async function verify() {
  for (const artifact of required) {
    try {
      await access(artifact, constants.R_OK);
    } catch {
      throw new Error(`Missing required artifact: ${artifact}`);
    }
  }
  const staticAssets = await readdir("out/_next/static", { recursive: true });
  if (staticAssets.length === 0) throw new Error("Missing required artifact: immutable Next static assets");
  const configSource = await readFile("out/staticwebapp.config.json", "utf8");
  if (configSource.includes(CSP_HASH_PLACEHOLDER)) throw new Error("Generated artifact contains a stale CSP hash placeholder.");
  const config = JSON.parse(configSource);
  assertStaticSecurityConfig(config, await inlineScriptHashes("out"));
  const worker = await readFile("out/view/sw.js", "utf8");
  if (worker.includes(SERVICE_WORKER_VERSION_PLACEHOLDER)) throw new Error("Generated artifact contains a stale service-worker release placeholder.");
  await assertPublicViewServiceWorker({ outputRoot: "out" });
}

try {
  await verify();
  process.stdout.write("Artifacts verified.\n");
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
