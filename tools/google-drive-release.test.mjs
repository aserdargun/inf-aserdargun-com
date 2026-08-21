import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("documented scratch verification builds its fold prerequisite from output-free Setup and compares exact inventory hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "inf-release-helper-")); const backup = join(root, "backup"); const scratch = join(root, "nested", "scratch");
  try {
    await Promise.all([rm("api/dist", { recursive: true, force: true }), rm("packages/contracts/dist", { recursive: true, force: true }), rm("packages/domain/dist", { recursive: true, force: true })]);
    await assert.rejects(access("api/dist")); await assert.rejects(access("packages/contracts/dist")); await assert.rejects(access("packages/domain/dist"));
    await mkdir(join(backup, "data", "public"), { recursive: true }); await mkdir(join(backup, "data", "private"), { recursive: true });
    const image = Buffer.from("backed-up-image"); const imagePath = "data/public/image.bin";
    const event = Buffer.from(JSON.stringify({
      eventId: "00000000-0000-4000-8000-000000000001", schemaVersion: 1, type: "infographic.created", occurredAt: "2026-08-20T10:00:00.000Z", infographicId: "11111111-1111-4111-8111-111111111111",
      payload: { originalDriveFileId: "original", thumbnailDriveFileId: "thumbnail", sha256: "a".repeat(64), detectedMimeType: "image/png", width: 20, height: 10, title: "Restored", capturedAt: "2026-08-20T09:00:00.000Z", createdAt: "2026-08-20T10:00:00.000Z", folderState: "Inbox" },
    })); const eventPath = "data/private/event.json";
    await writeFile(join(backup, imagePath), image); await writeFile(join(backup, eventPath), event);
    const files = [{ root: "public", mimeType: "image/png", relativePath: imagePath, sha256: createHash("sha256").update(image).digest("hex") }, { root: "private", mimeType: "application/json", relativePath: eventPath, sha256: createHash("sha256").update(event).digest("hex") }];
    await writeFile(join(backup, "manifest.json"), JSON.stringify({ schemaVersion: 1, files }));
    const inventory = join(root, "inventory.json"); await writeFile(inventory, JSON.stringify({ recovery: { items: [{ id: "11111111-1111-4111-8111-111111111111", title: "Restored", originalDriveFileId: "original", thumbnailDriveFileId: "thumbnail", sha256: "a".repeat(64), folderState: "Inbox" }] } }));
    const result = spawnSync(process.execPath, ["scripts/google-drive-release.mjs", "verify-backup", "--backup", backup, "--scratch", scratch, "--inventory", inventory], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); await access(join(scratch, "manifest.json")); await access(join(scratch, "folded-inventory.json"));
    assert.deepEqual(JSON.parse(await readFile(join(scratch, "folded-inventory.json"), "utf8")).items, [{ id: "11111111-1111-4111-8111-111111111111", title: "Restored", originalDriveFileId: "original", thumbnailDriveFileId: "thumbnail", sha256: "a".repeat(64), folderState: "Inbox" }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
