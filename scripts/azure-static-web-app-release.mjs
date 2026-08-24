import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const help = `Usage: node scripts/azure-static-web-app-release.mjs <command> --resource-group RG --name NAME [options]
  settings --env-file .env.local --subscription SUBSCRIPTION_ID --resource-group RG --name NAME
  deploy --resource-group RG --name NAME
  verify --resource-group RG --name NAME
`;
const runtimeKeys = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "INF_PRIVATE_DRIVE_FOLDER_ID", "INF_EVENTS_FOLDER_ID", "INF_INBOX_FOLDER_ID", "INF_LIBRARY_FOLDER_ID", "INF_THUMBNAILS_FOLDER_ID", "INF_DUPLICATES_FOLDER_ID", "OPENAI_API_KEY"];

export function appSettings(env) {
  const result = { INF_ALLOWED_GITHUB_USER: "aserdargun" };
  for (const key of runtimeKeys) { if (!env[key]) throw new Error(`${key} is missing from the env file.`); result[key] = env[key]; }
  return result;
}
function parseEnv(text) { return Object.fromEntries(text.split(/\r?\n/).map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((match) => [match[1], match[2]])); }
function args(argv) { const result = { command: argv[0] }; for (let i = 1; i < argv.length; i += 2) { if (!argv[i]?.startsWith("--") || argv[i + 1] === undefined) throw new Error("Invalid command options."); result[argv[i].slice(2)] = argv[i + 1]; } return result; }
function required(options, key) { if (!options[key]) throw new Error(`--${key} is required.`); return options[key]; }
async function az(args) { return (await execFile("az", args, { maxBuffer: 10 * 1024 * 1024 })).stdout.trim(); }

async function settings(options) {
  const subscription = required(options, "subscription"); const resourceGroup = required(options, "resource-group"); const name = required(options, "name");
  const siteUri = `https://management.azure.com/subscriptions/${encodeURIComponent(subscription)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Web/staticSites/${encodeURIComponent(name)}`;
  const current = JSON.parse(await az(["rest", "--method", "post", "--uri", `${siteUri}/listAppSettings?api-version=2025-05-01`, "--output", "json"]));
  const next = { properties: { ...(current.properties ?? {}), ...appSettings(parseEnv(await readFile(required(options, "env-file"), "utf8"))) } };
  const run = resolve(".codex/run"); await mkdir(run, { recursive: true, mode: 0o700 }); const body = resolve(run, "azure-appsettings.json");
  await writeFile(body, JSON.stringify(next), { mode: 0o600 }); await chmod(body, 0o600);
  try { await az(["rest", "--method", "put", "--uri", `${siteUri}/config/appsettings?api-version=2025-05-01`, "--body", `@${body}`, "--output", "none"]); }
  finally { await rm(body, { force: true }); }
  process.stdout.write("Azure Static Web App settings updated from the 0600 env file; secret values were not printed.\n");
}
async function deploy(options) {
  const resourceGroup = required(options, "resource-group"); const name = required(options, "name"); await stat("out/index.html"); await stat("api-dist/dist/index.js");
  const deploymentToken = await az(["staticwebapp", "secrets", "list", "--resource-group", resourceGroup, "--name", name, "--query", "properties.apiKey", "--output", "tsv"]);
  if (!deploymentToken) throw new Error("Azure returned no deployment token.");
  const { stdout, stderr } = await execFile("pnpm", ["exec", "swa", "deploy", "out", "--api-location", "api-dist", "--env", "production"], { env: { ...process.env, SWA_CLI_DEPLOYMENT_TOKEN: deploymentToken }, maxBuffer: 20 * 1024 * 1024 });
  process.stdout.write(`${stdout}${stderr}`); process.stdout.write("Prebuilt out/ and api-dist/ deployment completed.\n");
}
async function verify(options) {
  const resourceGroup = required(options, "resource-group"); const name = required(options, "name");
  const hostname = await az(["staticwebapp", "show", "--resource-group", resourceGroup, "--name", name, "--query", "defaultHostname", "--output", "tsv"]); if (!hostname) throw new Error("Generated hostname is empty.");
  const base = `https://${hostname}`;
  const view = await globalThis.fetch(`${base}/view/`); if (view.status !== 200 || !view.headers.get("content-type")?.includes("text/html")) throw new Error(`View verification failed: ${view.status}`);
  const catalog = await globalThis.fetch(`${base}/api/public/infographics`); if (catalog.status !== 200 || !catalog.headers.get("cache-control")?.includes("public") || catalog.headers.get("x-content-type-options") !== "nosniff") throw new Error(`Public API/header verification failed: ${catalog.status}`);
  const items = await catalog.json(); if (items[0]?.thumbnailUrl) { const image = await globalThis.fetch(new URL(items[0].thumbnailUrl, base)); if (image.status !== 200 || !image.headers.get("content-type")?.startsWith("image/")) throw new Error("Public image verification failed."); }
  const owner = await globalThis.fetch(base, { redirect: "manual" }); if (![302, 401].includes(owner.status)) throw new Error(`Owner auth boundary verification failed: ${owner.status}`);
  const hostnames = JSON.parse(await az(["staticwebapp", "hostname", "list", "--resource-group", resourceGroup, "--name", name, "--output", "json"])); if (hostnames.length !== 0) throw new Error("Custom hostname list is not empty; stop before custom-domain work.");
  process.stdout.write(`${JSON.stringify({ hostname, view: view.status, publicApi: catalog.status, ownerBoundary: owner.status, customHostnames: 0 }, null, 2)}\n`);
}
async function main() {
  const options = args(process.argv.slice(2)); if (!options.command || ["--help", "help"].includes(options.command)) { process.stdout.write(help); return; }
  if (options.command === "settings") return settings(options); if (options.command === "deploy") return deploy(options); if (options.command === "verify") return verify(options); throw new Error(`Unknown command.\n${help}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
