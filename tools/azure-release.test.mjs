import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appSettings } from "../scripts/azure-static-web-app-release.mjs";

test("Azure app settings use the exact server runtime names without a public-root setting", () => {
  const env = Object.fromEntries(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "INF_PRIVATE_DRIVE_FOLDER_ID", "INF_EVENTS_FOLDER_ID", "INF_INBOX_FOLDER_ID", "INF_LIBRARY_FOLDER_ID", "INF_THUMBNAILS_FOLDER_ID", "INF_DUPLICATES_FOLDER_ID"].map((key) => [key, `${key}-value`]));
  const settings = appSettings(env);
  assert.equal(settings.INF_ALLOWED_GITHUB_USER, "aserdargun"); assert.equal(settings.INF_PRIVATE_DRIVE_FOLDER_ID, "INF_PRIVATE_DRIVE_FOLDER_ID-value");
  assert.equal("INF_PUBLIC_DRIVE_ROOT_ID" in settings, false);
});

test("Azure release helper exposes non-echoing settings, prebuilt deploy, and verification commands", () => {
  const result = spawnSync(process.execPath, ["scripts/azure-static-web-app-release.mjs", "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0); assert.match(result.stdout, /settings/); assert.match(result.stdout, /deploy/); assert.match(result.stdout, /verify/);
});

test("Azure settings reads through listAppSettings before a secret-safe merged update", () => {
  const directory = mkdtempSync(join(tmpdir(), "inf-azure-settings-"));
  try {
    const fakeAz = join(directory, "az");
    const callsPath = join(directory, "calls.jsonl");
    const summaryPath = join(directory, "summary.json");
    const envPath = join(directory, "release.env");
    writeFileSync(fakeAz, `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.INF_AZ_CALLS, JSON.stringify(args) + "\\n");
const method = args[args.indexOf("--method") + 1];
const uri = args[args.indexOf("--uri") + 1];
if (method === "post" && uri.includes("/listAppSettings?api-version=2025-05-01")) {
  process.stdout.write(JSON.stringify({ properties: { EXISTING_SETTING: "preserved" } }));
} else if (method === "put" && uri.includes("/config/appsettings?api-version=2025-05-01")) {
  const bodyArgument = args[args.indexOf("--body") + 1];
  const bodyPath = bodyArgument.slice(1);
  const body = JSON.parse(readFileSync(bodyPath, "utf8"));
  writeFileSync(process.env.INF_AZ_SUMMARY, JSON.stringify({ bodyPath, keys: Object.keys(body.properties).sort(), preserved: body.properties.EXISTING_SETTING }));
} else {
  process.stderr.write("unexpected Azure invocation");
  process.exitCode = 42;
}
`);
    chmodSync(fakeAz, 0o755);
    writeFileSync(envPath, [
      "GOOGLE_CLIENT_ID=client-id",
      "GOOGLE_CLIENT_SECRET=client-secret",
      "GOOGLE_REFRESH_TOKEN=refresh-token",
      "INF_PRIVATE_DRIVE_FOLDER_ID=private",
      "INF_EVENTS_FOLDER_ID=events",
      "INF_INBOX_FOLDER_ID=inbox",
      "INF_LIBRARY_FOLDER_ID=library",
      "INF_THUMBNAILS_FOLDER_ID=thumbnails",
      "INF_DUPLICATES_FOLDER_ID=duplicates",
    ].join("\n"), { mode: 0o600 });
    const result = spawnSync(process.execPath, ["scripts/azure-static-web-app-release.mjs", "settings", "--env-file", envPath, "--subscription", "sub", "--resource-group", "rg", "--name", "swa"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, INF_AZ_CALLS: callsPath, INF_AZ_SUMMARY: summaryPath },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /client-secret|refresh-token/);
    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((args) => [args[args.indexOf("--method") + 1], args[args.indexOf("--uri") + 1]]), [
      ["post", "https://management.azure.com/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/staticSites/swa/listAppSettings?api-version=2025-05-01"],
      ["put", "https://management.azure.com/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/staticSites/swa/config/appsettings?api-version=2025-05-01"],
    ]);
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    assert.equal(summary.preserved, "preserved");
    assert.ok(summary.keys.includes("GOOGLE_CLIENT_SECRET"));
    assert.equal(summary.keys.length, 11);
    assert.throws(() => readFileSync(summary.bodyPath), /ENOENT/);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
