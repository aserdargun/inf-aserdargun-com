import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertPermissionBoundary, runtimeFolderEnvironment } from "../scripts/google-drive-release.mjs";

test("Drive provisioning accepts only a public anyone-reader boundary", () => {
  assert.doesNotThrow(() => assertPermissionBoundary([{ type: "anyone", role: "reader" }], [{ type: "user", role: "owner" }]));
  assert.throws(() => assertPermissionBoundary([], []), /anyone:reader/i);
  assert.throws(() => assertPermissionBoundary([{ type: "anyone", role: "writer" }], []), /anyone:reader/i);
  assert.throws(() => assertPermissionBoundary([{ type: "anyone", role: "reader" }], [{ type: "anyone", role: "reader" }]), /private/i);
});

test("Drive provisioning writes only exact runtime folder names and never invents a public-root variable", () => {
  const values = runtimeFolderEnvironment({ privateRoot: "private", Events: "events", Inbox: "inbox", Library: "library", Thumbnails: "thumbs", Duplicates: "dupes" });
  assert.deepEqual(values, {
    INF_PRIVATE_DRIVE_FOLDER_ID: "private", INF_EVENTS_FOLDER_ID: "events", INF_INBOX_FOLDER_ID: "inbox",
    INF_LIBRARY_FOLDER_ID: "library", INF_THUMBNAILS_FOLDER_ID: "thumbs", INF_DUPLICATES_FOLDER_ID: "dupes",
  });
  assert.equal("INF_PUBLIC_DRIVE_ROOT_ID" in values, false);
});

test("Drive release helper exposes executable authorize/provision/backup/verify commands", () => {
  const result = spawnSync(process.execPath, ["scripts/google-drive-release.mjs", "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0); assert.match(result.stdout, /authorize/); assert.match(result.stdout, /provision/); assert.match(result.stdout, /backup/); assert.match(result.stdout, /verify-backup/);
});

test("scratch verification populates a previously absent nested restore and checks exact hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "inf-release-helper-")); const backup = join(root, "backup"); const scratch = join(root, "nested", "scratch");
  try {
    await mkdir(join(backup, "data", "public"), { recursive: true }); const bytes = Buffer.from("backed-up-image"); const relativePath = "data/public/image.bin";
    await writeFile(join(backup, relativePath), bytes); await writeFile(join(backup, "manifest.json"), JSON.stringify({ schemaVersion: 1, files: [{ root: "public", mimeType: "image/png", relativePath, sha256: createHash("sha256").update(bytes).digest("hex") }] }));
    const result = spawnSync(process.execPath, ["scripts/google-drive-release.mjs", "verify-backup", "--backup", backup, "--scratch", scratch], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); await access(join(scratch, "manifest.json")); await access(join(scratch, "folded-inventory.json"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
