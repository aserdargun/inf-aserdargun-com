import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const workflowPath = ".github/workflows/deploy-swa-inf-aserdargun-com.yml";
const validateCommand = "pnpm lint && pnpm typecheck && pnpm api:build && pnpm web:build && pnpm artifact:verify && pnpm lifecycle:test && pnpm test && pnpm e2e && git diff --check";
const tokenExpression = "$" + "{{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_SWA_INF_ASERDARGUN_COM }}";

const validWorkflow = `name: Deploy INF to Azure Static Web Apps

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: swa-inf-aserdargun-com-production
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
      - name: Set up Node.js
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
        with:
          node-version: "22"
      - name: Activate locked pnpm
        run: |
          corepack enable
          corepack prepare pnpm@11.22.0 --activate
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Install Playwright Chromium prerequisites
        run: pnpm exec playwright install --with-deps chromium
      - name: Validate CI release
        run: pnpm validate:ci
      - name: Verify deployment contract
        run: pnpm deployment:verify
      - name: Verify prebuilt artifacts
        run: |
          test -d out
          test -d api-dist
          pnpm artifact:verify
      - name: Deploy prebuilt artifacts
        uses: Azure/static-web-apps-deploy@4d27395796ac319302594769cfe812bd207490b1
        with:
          azure_static_web_apps_api_token: ${tokenExpression}
          action: upload
          app_location: out
          api_location: api-dist
          output_location: ""
          skip_app_build: true
          skip_api_build: true
`;

const manifest = {
  name: "inf-aserdargun-com",
  private: true,
  packageManager: "pnpm@11.22.0",
  engines: { node: ">=22.0.0 <23" },
  scripts: {
    "artifact:verify": "node scripts/verify-artifacts.mjs",
    "deployment:verify": "node scripts/verify-deployment-contract.mjs",
    "validate:ci": validateCommand,
    "validate:codex": validateCommand,
  },
};

async function fixture({ workflow = validWorkflow, extraWorkflow, packageJson = manifest } = {}) {
  const root = await mkdtemp(join(tmpdir(), "inf-deployment-contract-"));
  await mkdir(join(root, ".github/workflows"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  if (workflow !== null) await writeFile(join(root, workflowPath), workflow);
  if (extraWorkflow) await writeFile(join(root, ".github/workflows/duplicate-azure.yml"), extraWorkflow);
  return root;
}

test("deployment contract parser accepts only the pinned non-domain production workflow", async () => {
  const { verifyDeploymentContract } = await import("../scripts/verify-deployment-contract.mjs");
  assert.equal(typeof verifyDeploymentContract, "function");

  const validRoot = await fixture();
  try {
    await assert.doesNotReject(() => verifyDeploymentContract(validRoot));
  } finally {
    await rm(validRoot, { recursive: true, force: true });
  }

  const workflowCases = [
    ["missing workflow", null, /workflow/i],
    ["wrong branch", validWorkflow.replace("      - main", "      - develop"), /main|branch/i],
    ["missing branch", validWorkflow.replace(/ {2}push:\n {4}branches:\n {6}- main\n/, "  push:\n"), /main|branch/i],
    ["missing dispatch", validWorkflow.replace("  workflow_dispatch:\n", ""), /dispatch/i],
    ["self-hosted runner", validWorkflow.replace("runs-on: ubuntu-latest", "runs-on: self-hosted"), /ubuntu-latest|runner/i],
    ["extra job", validWorkflow.replace("jobs:\n", "jobs:\n  audit:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm lint\n"), /one|deploy job|topology/i],
    ["write permissions", validWorkflow.replace("contents: read", "contents: write"), /permission/i],
    ["missing permissions", validWorkflow.replace(/permissions:\n {2}contents: read\n\n/, ""), /permission/i],
    ["wrong concurrency", validWorkflow.replace("swa-inf-aserdargun-com-production", "deploy-swa-inf-aserdargun-com"), /concurrency/i],
    ["cancel in progress", validWorkflow.replace("cancel-in-progress: false", "cancel-in-progress: true"), /cancel/i],
    ["floating checkout", validWorkflow.replace("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", "actions/checkout@v7"), /checkout|SHA|pin/i],
    ["floating setup-node", validWorkflow.replace("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020", "actions/setup-node@v7"), /setup-node|SHA|pin/i],
    ["floating Azure action", validWorkflow.replace("Azure/static-web-apps-deploy@4d27395796ac319302594769cfe812bd207490b1", "Azure/static-web-apps-deploy@v1"), /Azure|SHA|pin/i],
    ["wrong Node", validWorkflow.replace('node-version: "22"', 'node-version: "20"'), /Node/i],
    ["wrong pnpm", validWorkflow.replace("pnpm@11.22.0", "pnpm@11.21.0"), /pnpm/i],
    ["unfrozen install", validWorkflow.replace("pnpm install --frozen-lockfile", "pnpm install"), /frozen/i],
    ["missing Chromium prerequisites", validWorkflow.replace("pnpm exec playwright install --with-deps chromium", "pnpm exec playwright install chromium"), /Playwright|Chromium|with-deps/i],
    ["wrong validation", validWorkflow.replace("pnpm validate:ci", "pnpm validate:codex"), /validate:ci/i],
    ["missing artifact directory check", validWorkflow.replace("          test -d api-dist\n", ""), /api-dist|artifact/i],
    ["missing artifact verification", validWorkflow.replace("          pnpm artifact:verify\n", ""), /artifact/i],
    ["wrong web artifact", validWorkflow.replace("app_location: out", "app_location: dist"), /app_location|out/i],
    ["wrong API artifact", validWorkflow.replace("api_location: api-dist", "api_location: api"), /api_location|api-dist/i],
    ["wrong secret", validWorkflow.replace("AZURE_STATIC_WEB_APPS_API_TOKEN_SWA_INF_ASERDARGUN_COM", "AZURE_STATIC_WEB_APPS_API_TOKEN_OTHER"), /secret|token/i],
    ["wrong action", validWorkflow.replace("action: upload", "action: close"), /upload|action/i],
    ["app build enabled", validWorkflow.replace("skip_app_build: true", "skip_app_build: false"), /skip_app_build/i],
    ["API build enabled", validWorkflow.replace("skip_api_build: true", "skip_api_build: false"), /skip_api_build/i],
    ["non-empty output", validWorkflow.replace('output_location: ""', "output_location: dist"), /output_location/i],
    ["custom domain command", validWorkflow.replace("      - name: Deploy prebuilt artifacts", "      - run: az staticwebapp hostname set --hostname inf.aserdargun.com\n      - name: Deploy prebuilt artifacts"), /custom domain|DNS|hostname/i],
    ["unsupported deploy input", validWorkflow.replace("          action: upload", `          repo_token: ${"$" + "{{ secrets.GITHUB_TOKEN }}"}\n          action: upload`), /unsupported|repo_token|source/i],
    ["source integration input", validWorkflow.replace("          action: upload", "          production_branch: main\n          action: upload"), /unsupported|production_branch|source/i],
  ];

  for (const [label, workflow, error] of workflowCases) {
    const root = await fixture({ workflow });
    try {
      await assert.rejects(() => verifyDeploymentContract(root), error, label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  const duplicateRoot = await fixture({ extraWorkflow: validWorkflow });
  try {
    await assert.rejects(() => verifyDeploymentContract(duplicateRoot), /one|duplicate|authoritative/i);
  } finally {
    await rm(duplicateRoot, { recursive: true, force: true });
  }

  for (const [label, packageJson, error] of [
    ["wrong locked pnpm", { ...manifest, packageManager: "pnpm@11.21.0" }, /pnpm/i],
    ["wrong Node contract", { ...manifest, engines: { node: ">=20 <23" } }, /Node/i],
    ["incomplete CI validation", { ...manifest, scripts: { ...manifest.scripts, "validate:ci": "pnpm lint" } }, /validate:ci/i],
    ["changed local validation", { ...manifest, scripts: { ...manifest.scripts, "validate:codex": "pnpm lint" } }, /validate:codex/i],
    ["missing verifier script", { ...manifest, scripts: { ...manifest.scripts, "deployment:verify": undefined } }, /deployment:verify/i],
  ]) {
    const root = await fixture({ packageJson });
    try {
      await assert.rejects(() => verifyDeploymentContract(root), error, label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
