import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const contract = Object.freeze({
  workflow: ".github/workflows/deploy-swa-inf-aserdargun-com.yml",
  concurrency: "swa-inf-aserdargun-com-production",
  secret: "AZURE_STATIC_WEB_APPS_API_TOKEN_SWA_INF_ASERDARGUN_COM",
  checkout: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  setupNode: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  deploy: "Azure/static-web-apps-deploy@4d27395796ac319302594769cfe812bd207490b1",
});

const validationCommands = [
  "pnpm lint",
  "pnpm typecheck",
  "pnpm api:build",
  "pnpm web:build",
  "pnpm artifact:verify",
  "pnpm lifecycle:test",
  "pnpm test",
  "pnpm e2e",
  "git diff --check",
];

function requireContract(condition, message) {
  if (!condition) throw new Error(`Deployment contract invalid: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isRecord(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function commandLines(step) {
  return typeof step?.run === "string" ? step.run.split("\n").map((line) => line.trim()).filter(Boolean) : [];
}

function workflowSteps(workflow) {
  requireContract(isRecord(workflow.jobs), "workflow jobs are missing");
  const entries = [];
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    requireContract(isRecord(job), `job ${jobName} is malformed`);
    requireContract(job.permissions === undefined, `job ${jobName} must not override top-level permissions`);
    requireContract(Array.isArray(job.steps), `job ${jobName} steps are missing`);
    for (const [index, step] of job.steps.entries()) {
      requireContract(isRecord(step), `job ${jobName} step ${index + 1} is malformed`);
      entries.push({ jobName, index, step });
    }
  }
  return entries;
}

async function readYaml(path) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Deployment contract invalid: required workflow is missing at ${contract.workflow}`);
    throw error;
  }
  try {
    const value = parse(source);
    requireContract(isRecord(value), `${path} is not a YAML mapping`);
    return value;
  } catch (error) {
    if (String(error?.message).startsWith("Deployment contract invalid:")) throw error;
    throw new Error(`Deployment contract invalid: ${path} is not valid YAML (${error.message})`);
  }
}

function requireManifest(manifest) {
  requireContract(manifest.name === "inf-aserdargun-com", "package name must be inf-aserdargun-com");
  requireContract(manifest.packageManager === "pnpm@11.22.0", "locked pnpm version must be 11.22.0");
  requireContract(manifest.engines?.node === ">=22.0.0 <23", "Node contract must require Node 22");
  requireContract(manifest.scripts?.["deployment:verify"] === "node scripts/verify-deployment-contract.mjs", "deployment:verify script is missing or changed");
  requireContract(typeof manifest.scripts?.["validate:ci"] === "string", "validate:ci script is missing");
  requireContract(manifest.scripts["validate:ci"] === manifest.scripts["validate:codex"], "validate:codex must remain the complete local contract and validate:ci must match it");
  const actualCommands = manifest.scripts["validate:ci"].split("&&").map((command) => command.trim());
  requireContract(JSON.stringify(actualCommands) === JSON.stringify(validationCommands), "validate:ci must retain the complete CI-safe validation sequence");
}

function requireTriggers(workflow) {
  requireContract(exactKeys(workflow.on, ["push", "workflow_dispatch"]), "workflow must have only push and workflow_dispatch triggers");
  requireContract(exactKeys(workflow.on.push, ["branches"]), "push trigger must declare the production branch");
  requireContract(Array.isArray(workflow.on.push.branches) && workflow.on.push.branches.length === 1 && workflow.on.push.branches[0] === "main", "push branch must be exactly main");
  requireContract(workflow.on.workflow_dispatch === null || (isRecord(workflow.on.workflow_dispatch) && Object.keys(workflow.on.workflow_dispatch).length === 0), "workflow_dispatch must be enabled without unsupported configuration");
}

function requireTopLevelPolicy(workflow) {
  requireContract(exactKeys(workflow.permissions, ["contents"]) && workflow.permissions.contents === "read", "top-level permissions must be exactly contents: read");
  requireContract(exactKeys(workflow.concurrency, ["group", "cancel-in-progress"]), "top-level concurrency policy is missing or unsupported");
  requireContract(workflow.concurrency.group === contract.concurrency, `concurrency group must be ${contract.concurrency}`);
  requireContract(workflow.concurrency["cancel-in-progress"] === false, "cancel-in-progress must be false");
}

function requireJobTopology(workflow) {
  requireContract(exactKeys(workflow.jobs, ["deploy"]), "workflow must contain exactly one job named deploy");
  requireContract(workflow.jobs.deploy["runs-on"] === "ubuntu-latest", "deploy runner must be exactly ubuntu-latest");
}

function requireNoDomainCommands(workflows) {
  const forbidden = /\baz\s+staticwebapp\s+(?:hostname|custom-domain)\b|\baz\s+network\s+dns\b|\bcustom[- ]domain\b|\b(?:CNAME|TXT)\b|\bihsdns\b|\binf\.aserdargun\.com\b/i;
  for (const { path, value } of workflows) {
    for (const { step } of workflowSteps(value)) {
      if (typeof step.run === "string") requireContract(!forbidden.test(step.run), `custom domain or DNS command is prohibited in ${path}`);
    }
  }
}

function requirePinnedActions(steps) {
  const allowed = new Set([contract.checkout, contract.setupNode, contract.deploy]);
  const actionSteps = steps.filter(({ step }) => typeof step.uses === "string");
  for (const { step } of actionSteps) requireContract(allowed.has(step.uses), `unsupported or unpinned action ${step.uses}`);
  for (const [label, action] of [["checkout", contract.checkout], ["setup-node", contract.setupNode], ["Azure deploy", contract.deploy]]) {
    requireContract(actionSteps.filter(({ step }) => step.uses === action).length === 1, `${label} action must use its exact pinned SHA once`);
  }
}

function locateRunStep(steps, exactCommand, label) {
  const matches = steps.filter(({ step }) => commandLines(step).includes(exactCommand));
  requireContract(matches.length === 1, `${label} command is missing or duplicated`);
  return matches[0];
}

function requireBuildSequence(steps, deployEntry) {
  const setupEntry = steps.find(({ step }) => step.uses === contract.setupNode);
  requireContract(exactKeys(setupEntry?.step.with, ["node-version"]) && String(setupEntry.step.with["node-version"]) === "22", "setup-node must select Node 22 without unsupported inputs");
  const pnpmEntry = locateRunStep(steps, "corepack prepare pnpm@11.22.0 --activate", "locked pnpm activation");
  requireContract(commandLines(pnpmEntry.step).includes("corepack enable"), "Corepack must be enabled before pnpm activation");
  const installEntry = locateRunStep(steps, "pnpm install --frozen-lockfile", "frozen dependency install");
  const playwrightEntry = locateRunStep(steps, "pnpm exec playwright install --with-deps chromium", "Playwright Chromium prerequisites");
  const validateEntry = locateRunStep(steps, "pnpm validate:ci", "validate:ci");
  const helperEntry = locateRunStep(steps, "pnpm deployment:verify", "deployment contract verification");
  const artifactEntries = steps.filter(({ step }) => {
    const lines = commandLines(step);
    return lines.includes("test -d out") && lines.includes("test -d api-dist") && lines.includes("pnpm artifact:verify");
  });
  requireContract(artifactEntries.length === 1, "out and api-dist artifact existence plus artifact verification must share one step");
  const artifactEntry = artifactEntries[0];
  const sameJob = [setupEntry, pnpmEntry, installEntry, playwrightEntry, validateEntry, helperEntry, artifactEntry, deployEntry].every((entry) => entry?.jobName === deployEntry.jobName);
  requireContract(sameJob, "setup, validation, artifact checks, and deploy must run in one ordered job");
  const checkoutEntry = steps.find(({ step }) => step.uses === contract.checkout);
  const ordered = [checkoutEntry, setupEntry, pnpmEntry, installEntry, playwrightEntry, validateEntry, helperEntry, artifactEntry, deployEntry].map((entry) => entry.index);
  requireContract(ordered.every((index, position) => position === 0 || ordered[position - 1] < index), "checkout, setup, validation, artifact verification, and deployment steps are out of order");
}

function requireDeployStep(steps) {
  const deployEntries = steps.filter(({ step }) => step.uses === contract.deploy);
  requireContract(deployEntries.length === 1, "one pinned Azure upload step is required");
  const deployEntry = deployEntries[0];
  const allowedInputs = ["action", "api_location", "app_location", "azure_static_web_apps_api_token", "output_location", "skip_api_build", "skip_app_build"];
  requireContract(exactKeys(deployEntry.step.with, allowedInputs), "Azure deploy step has missing, unsupported, or source-integration inputs");
  const inputs = deployEntry.step.with;
  requireContract(inputs.azure_static_web_apps_api_token === `\${{ secrets.${contract.secret} }}`, `Azure deploy must read only the ${contract.secret} secret`);
  requireContract(inputs.action === "upload", "Azure deploy action must be upload");
  requireContract(inputs.app_location === "out", "app_location must be out");
  requireContract(inputs.api_location === "api-dist", "api_location must be api-dist");
  requireContract(inputs.output_location === "", "output_location must be empty");
  requireContract(inputs.skip_app_build === true, "skip_app_build must be true");
  requireContract(inputs.skip_api_build === true, "skip_api_build must be true");
  requireBuildSequence(steps, deployEntry);
}

export async function verifyDeploymentContract(root = process.cwd()) {
  const repositoryRoot = resolve(root);
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
  requireManifest(manifest);

  const workflowDirectory = resolve(repositoryRoot, ".github/workflows");
  let names;
  try {
    names = (await readdir(workflowDirectory)).filter((name) => /\.ya?ml$/i.test(name)).sort();
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Deployment contract invalid: required workflow is missing at ${contract.workflow}`);
    throw error;
  }
  const workflows = [];
  for (const name of names) workflows.push({ path: `.github/workflows/${name}`, value: await readYaml(resolve(workflowDirectory, name)) });
  const target = workflows.find(({ path }) => path === contract.workflow);
  requireContract(target, `required workflow is missing at ${contract.workflow}`);
  requireTriggers(target.value);
  requireTopLevelPolicy(target.value);
  requireJobTopology(target.value);
  requireNoDomainCommands(workflows);

  const workflowActionEntries = workflows.flatMap(({ path, value }) => workflowSteps(value).map((entry) => ({ ...entry, path })));
  const azureEntries = workflowActionEntries.filter(({ step }) => typeof step.uses === "string" && step.uses.toLowerCase().startsWith("azure/static-web-apps-deploy@"));
  requireContract(azureEntries.length === 1 && azureEntries[0].path === contract.workflow, "exactly one authoritative production Azure workflow is required");
  const targetSteps = workflowSteps(target.value);
  requirePinnedActions(targetSteps);
  requireDeployStep(targetSteps);
  return { ...contract, artifacts: ["out", "api-dist"], branch: "main", region: "westeurope", sku: "Free" };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    const verified = await verifyDeploymentContract();
    process.stdout.write(`Deployment contract verified for ${verified.workflow}. Custom domains are prohibited.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
