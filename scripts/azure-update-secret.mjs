// Minimal helper: merge a single secret from an env file into Azure Static Web Apps app settings
// without printing the secret. Reads existing settings, overlays keys found in the env file,
// writes to a 0600 temp body, and PUTs the result.
import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const help = `Usage: node scripts/azure-update-secret.mjs --env-file PATH --key NAME --subscription ID --resource-group RG --name APP
Merges the named key from the env file into the existing app settings. Secret values are never printed.`;

function args(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("--") || argv[i + 1] === undefined) throw new Error("Invalid options.");
    result[argv[i].slice(2)] = argv[i + 1];
  }
  return result;
}
function required(options, key) { if (!options[key]) throw new Error(`--${key} is required.`); return options[key]; }
async function az(args) { return (await execFile("az", args, { maxBuffer: 10 * 1024 * 1024 })).stdout; }

function parseEnv(text) {
  return Object.fromEntries(
    text.split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
}

async function updateSecret(options) {
  const subscription = required(options, "subscription");
  const resourceGroup = required(options, "resource-group");
  const name = required(options, "name");
  const key = required(options, "key");
  const envFile = required(options, "env-file");
  const env = parseEnv(await readFile(envFile, "utf8"));
  if (!env[key]) throw new Error(`${key} is missing from ${envFile}.`);
  const siteUri = `https://management.azure.com/subscriptions/${encodeURIComponent(subscription)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Web/staticSites/${encodeURIComponent(name)}`;
  const currentRaw = await az(["rest", "--method", "post", "--uri", `${siteUri}/listAppSettings?api-version=2025-05-01`, "--output", "json"]);
  const current = JSON.parse(currentRaw);
  const currentProps = current.properties ?? {};
  const nextProps = { ...currentProps, [key]: env[key] };
  const run = resolve(".codex/run");
  await mkdir(run, { recursive: true, mode: 0o700 });
  const body = resolve(run, "azure-appsettings.json");
  await writeFile(body, JSON.stringify({ properties: nextProps }), { mode: 0o600 });
  await chmod(body, 0o600);
  try {
    await az(["rest", "--method", "put", "--uri", `${siteUri}/config/appsettings?api-version=2025-05-01`, "--body", `@${body}`, "--output", "none"]);
  } finally {
    await rm(body, { force: true });
  }
  process.stdout.write(`Merged ${key} (length ${env[key].length}) into ${name} app settings; existing values preserved. Secret value not printed.\n`);
}

async function main() {
  const options = args(process.argv.slice(2));
  if (Object.keys(options).length === 0) { process.stdout.write(help); return; }
  await updateSecret(options);
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
