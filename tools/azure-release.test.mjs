import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
