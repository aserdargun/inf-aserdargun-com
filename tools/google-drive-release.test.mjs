import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { URL, URLSearchParams } from "node:url";
import * as driveRelease from "../scripts/google-drive-release.mjs";

const { assertPermissionBoundary, runtimeFolderEnvironment } = driveRelease;

test("repository ignores the mode-0600 OAuth handoff and common credential artifacts", () => {
  for (const path of [".env.local", "client_secret.json", "credentials.json", "token.json"]) {
    const result = spawnSync("git", ["check-ignore", "--quiet", path]);
    assert.equal(result.status, 0, `${path} must be ignored`);
  }
});

test("exact Task 15 authorize and provision entrypoints delegate without secret CLI arguments", () => {
  for (const script of ["scripts/google-drive-authorize.mjs", "scripts/google-drive-provision.mjs"]) {
    const result = spawnSync(process.execPath, [script, "--help"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /--client-secret|--refresh-token|--authorization-code/i);
    assert.match(result.stdout, /\.env\.local/);
  }
});

test("OAuth request uses random state, PKCE S256, full Drive scope, and a loopback redirect", async () => {
  assert.equal(typeof driveRelease.createOAuthRequest, "function");
  const first = driveRelease.createOAuthRequest("client-id", "http://127.0.0.1:34567/oauth/callback");
  const second = driveRelease.createOAuthRequest("client-id", "http://127.0.0.1:34567/oauth/callback");
  assert.notEqual(first.state, second.state);
  assert.notEqual(first.verifier, second.verifier);
  assert.match(first.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  const url = new URL(first.url);
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/drive");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:34567/oauth/callback");
  assert.equal(url.searchParams.get("state"), first.state);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{43}$/);
  const fixedState = "s".repeat(43);
  const fixed = driveRelease.createOAuthRequest("client-id", "http://127.0.0.1:34567/oauth/callback", { state: fixedState });
  assert.equal(fixed.state, fixedState);
  assert.equal(new URL(fixed.url).searchParams.get("state"), fixedState);
});

test("OAuth exchange sends PKCE verifier and owner verification rejects a different account", async () => {
  assert.equal(typeof driveRelease.exchangeAuthorizationCode, "function");
  assert.equal(typeof driveRelease.verifyDriveOwner, "function");
  let exchangeBody = "";
  const fetchExchange = async (_url, init) => {
    exchangeBody = String(init.body);
    return new globalThis.Response(JSON.stringify({ access_token: "access-value", refresh_token: "refresh-value" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const tokens = await driveRelease.exchangeAuthorizationCode({ clientId: "client-id", clientSecret: "client-secret", code: "authorization-code", verifier: "pkce-verifier", redirectUri: "http://127.0.0.1:30001/oauth/callback", fetchImpl: fetchExchange });
  assert.deepEqual(tokens, { accessToken: "access-value", refreshToken: "refresh-value" });
  const body = new URLSearchParams(exchangeBody);
  assert.equal(body.get("code_verifier"), "pkce-verifier");
  assert.equal(body.get("code"), "authorization-code");
  assert.equal(body.get("client_secret"), "client-secret");

  const fetchOwner = async () => new globalThis.Response(JSON.stringify({ user: { emailAddress: "different@example.com", displayName: "Different" } }), { status: 200 });
  await assert.rejects(driveRelease.verifyDriveOwner("access-value", "aserdargun@gmail.com", fetchOwner), /owner/i);
});

test("OAuth callback listens only on loopback, validates state, and times out within a bound", async () => {
  assert.equal(typeof driveRelease.createOAuthCallbackSession, "function");
  const state = "s".repeat(43);
  const rejected = await driveRelease.createOAuthCallbackSession(state, { timeoutMs: 1_000 });
  try {
    const redirect = new URL(rejected.redirectUri);
    assert.equal(redirect.hostname, "127.0.0.1");
    assert.equal(redirect.pathname, "/oauth/callback");
    const rejectedCode = assert.rejects(rejected.code, /state\/code/i);
    const response = await fetch(`${rejected.redirectUri}?state=wrong-state&code=never-log-this`);
    assert.equal(response.status, 400);
    await rejectedCode;
  } finally { await rejected.close(); }

  const accepted = await driveRelease.createOAuthCallbackSession(state, { timeoutMs: 1_000 });
  try {
    const response = await fetch(`${accepted.redirectUri}?state=${state}&code=accepted-code`);
    assert.equal(response.status, 200);
    await assert.doesNotReject(async () => assert.equal(await accepted.code, "accepted-code"));
  } finally { await accepted.close(); }

  const timedOut = await driveRelease.createOAuthCallbackSession(state, { timeoutMs: 20 });
  try { const timeout = assert.rejects(timedOut.code, /timed out/i); await timeout; } finally { await timedOut.close(); }
});

test("Drive provisioning accepts only exact owner plus public anyone-reader boundaries", () => {
  const owner = { type: "user", role: "owner", emailAddress: "aserdargun@gmail.com" };
  const publicPermissions = [owner, { type: "anyone", role: "reader", allowFileDiscovery: false }];
  assert.doesNotThrow(() => assertPermissionBoundary(publicPermissions, [owner], [owner], "aserdargun@gmail.com"));
  assert.throws(() => assertPermissionBoundary(undefined, [owner], [owner], "aserdargun@gmail.com"), /metadata/i);
  assert.throws(() => assertPermissionBoundary([owner], [owner], [owner], "aserdargun@gmail.com"), /anyone:reader/i);
  assert.throws(() => assertPermissionBoundary([owner, { type: "anyone", role: "writer", allowFileDiscovery: false }], [owner], [owner], "aserdargun@gmail.com"), /anyone:reader/i);
  assert.throws(() => assertPermissionBoundary([...publicPermissions, { type: "domain", role: "reader", domain: "example.com" }], [owner], [owner], "aserdargun@gmail.com"), /unrelated|exact/i);
  assert.throws(() => assertPermissionBoundary(publicPermissions, [owner, { type: "anyone", role: "reader" }], [owner], "aserdargun@gmail.com"), /private/i);
  assert.throws(() => assertPermissionBoundary(publicPermissions, [owner], [{ type: "group", role: "reader", emailAddress: "team@example.com" }], "aserdargun@gmail.com"), /test root/i);
  assert.throws(() => assertPermissionBoundary(publicPermissions, [owner], [owner], "other@example.com"), /owner/i);
});

test("Drive provisioning writes only exact runtime folder names and never invents a public-root variable", () => {
  const values = runtimeFolderEnvironment({ privateRoot: "private", Events: "events", Inbox: "inbox", Library: "library", Thumbnails: "thumbs", Duplicates: "dupes" });
  assert.deepEqual(values, {
    INF_PRIVATE_DRIVE_FOLDER_ID: "private", INF_EVENTS_FOLDER_ID: "events", INF_INBOX_FOLDER_ID: "inbox",
    INF_LIBRARY_FOLDER_ID: "library", INF_THUMBNAILS_FOLDER_ID: "thumbs", INF_DUPLICATES_FOLDER_ID: "dupes",
  });
  assert.equal("INF_PUBLIC_DRIVE_ROOT_ID" in values, false);
});

test("provisioning persists every operational audit ID while deployment stays runtime-minimal", () => {
  assert.equal(typeof driveRelease.provisionFolderEnvironment, "function");
  const ids = {
    privateRoot: "private", Inbox: "inbox", Library: "library", Archive: "archive", Duplicates: "dupes", Thumbnails: "thumbs",
    events: "events", reviews: "reviews", quarantine: "quarantine", exports: "exports", testRoot: "test-root",
  };
  assert.deepEqual(driveRelease.provisionFolderEnvironment(ids), {
    INF_PRIVATE_DRIVE_FOLDER_ID: "private", INF_INBOX_FOLDER_ID: "inbox", INF_LIBRARY_FOLDER_ID: "library", INF_ARCHIVE_FOLDER_ID: "archive",
    INF_DUPLICATES_FOLDER_ID: "dupes", INF_THUMBNAILS_FOLDER_ID: "thumbs", INF_EVENTS_FOLDER_ID: "events", INF_REVIEWS_FOLDER_ID: "reviews",
    INF_QUARANTINE_FOLDER_ID: "quarantine", INF_EXPORTS_FOLDER_ID: "exports", INF_DRIVE_TEST_ROOT_ID: "test-root",
  });
  assert.deepEqual(runtimeFolderEnvironment(ids), {
    INF_PRIVATE_DRIVE_FOLDER_ID: "private", INF_EVENTS_FOLDER_ID: "events", INF_INBOX_FOLDER_ID: "inbox",
    INF_LIBRARY_FOLDER_ID: "library", INF_THUMBNAILS_FOLDER_ID: "thumbs", INF_DUPLICATES_FOLDER_ID: "dupes",
  });
});

test("provisioning is idempotent, recovers before env write, and validates configured roots", async () => {
  assert.equal(typeof driveRelease.provisionWithClient, "function");
  const owner = "aserdargun@gmail.com";
  const created = new Map([
    [driveRelease.PUBLIC_ROOT_ID, { id: driveRelease.PUBLIC_ROOT_ID, name: "INF-ASERDARGUN-COM", mimeType: "application/vnd.google-apps.folder", trashed: false, parents: ["my-drive-root"], owners: [{ emailAddress: owner }] }],
  ]);
  let nextId = 1;
  const permissions = [{ type: "user", role: "owner", emailAddress: owner }];
  const client = {
    async about() { return { user: { emailAddress: owner, displayName: "Serdar Gundogdu" } }; },
    async getFile(id) { const file = created.get(id); if (!file) throw new Error(`missing ${id}`); return file; },
    async listChildren(parentId) { return [...created.values()].filter((file) => file.parents?.includes(parentId)); },
    async createFolder(name, parentId) { const id = `created-${nextId++}`; const file = { id, name, mimeType: "application/vnd.google-apps.folder", trashed: false, parents: parentId ? [parentId] : [], owners: [{ emailAddress: owner }] }; created.set(id, file); return file; },
    async permissions(id) { return id === driveRelease.PUBLIC_ROOT_ID ? [...permissions, { type: "anyone", role: "reader", allowFileDiscovery: false }] : permissions; },
  };
  const first = await driveRelease.provisionWithClient(client, {}, { expectedOwner: owner });
  const countAfterFailureWindow = created.size;
  const second = await driveRelease.provisionWithClient(client, {}, { expectedOwner: owner });
  assert.deepEqual(second, first);
  assert.equal(created.size, countAfterFailureWindow);
  assert.equal((await client.listChildren(driveRelease.PUBLIC_ROOT_ID)).filter((file) => file.name === "Inbox").length, 1);
  assert.equal((await client.listChildren(first.privateRoot)).filter((file) => file.name === "events").length, 1);

  await assert.rejects(
    driveRelease.provisionWithClient(client, { INF_PRIVATE_DRIVE_FOLDER_ID: driveRelease.PUBLIC_ROOT_ID }, { expectedOwner: owner }),
    /private.*mismatch|configured.*private/i,
  );
  await assert.rejects(
    driveRelease.provisionWithClient(client, { INF_INBOX_FOLDER_ID: "foreign-inbox" }, { expectedOwner: owner }),
    /configured.*Inbox.*mismatch/i,
  );
});

test("provisioning HTTP client paginates exact-parent listings without exposing its bearer token", async () => {
  assert.equal(typeof driveRelease.createProvisionClient, "function");
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), authorization: init.headers.authorization });
    const page = new URL(String(url)).searchParams.get("pageToken");
    return new globalThis.Response(JSON.stringify(page ? {
      files: [{ id: "second", name: "second", mimeType: "application/vnd.google-apps.folder", trashed: false, parents: ["parent"] }],
    } : {
      nextPageToken: "next-page", files: [{ id: "first", name: "first", mimeType: "application/vnd.google-apps.folder", trashed: false, parents: ["parent"] }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = driveRelease.createProvisionClient("bearer-secret", fetchImpl);
  assert.deepEqual((await client.listChildren("parent")).map((entry) => entry.id), ["first", "second"]);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /fields=nextPageToken/);
  assert.match(requests[1].url, /pageToken=next-page/);
  assert.deepEqual(requests.map((request) => request.authorization), ["Bearer bearer-secret", "Bearer bearer-secret"]);
});

test("atomic env updates retain credentials, use mode 0600, and never expose values in output", async () => {
  assert.equal(typeof driveRelease.updateEnvironmentFile, "function");
  const root = await mkdtemp(join(tmpdir(), "inf-env-"));
  const envFile = join(root, ".env.local");
  try {
    await writeFile(envFile, "GOOGLE_CLIENT_ID=client-id\nGOOGLE_CLIENT_SECRET=secret-value\n", { mode: 0o644 });
    await driveRelease.updateEnvironmentFile(envFile, { GOOGLE_REFRESH_TOKEN: "refresh-value", INF_INBOX_FOLDER_ID: "inbox" });
    const contents = await readFile(envFile, "utf8");
    assert.match(contents, /^GOOGLE_CLIENT_ID=client-id$/m);
    assert.match(contents, /^GOOGLE_CLIENT_SECRET=secret-value$/m);
    assert.match(contents, /^GOOGLE_REFRESH_TOKEN=refresh-value$/m);
    assert.equal((await stat(envFile)).mode & 0o777, 0o600);
    const debris = (await import("node:fs/promises")).readdir(root);
    assert.deepEqual((await debris).sort(), [".env.local"]);
  } finally { await rm(root, { recursive: true, force: true }); }
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
