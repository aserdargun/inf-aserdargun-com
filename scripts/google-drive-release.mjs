import { createHash, randomBytes } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { createServer } from "node:http";
import { chmod, cp, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const PUBLIC_ROOT_ID = "1wijWSRvrjEZ3y78bKsAQS8mOP0OPvgsK";
export const EXPECTED_OWNER = "aserdargun@gmail.com";
const folderMimeType = "application/vnd.google-apps.folder";
const scope = "https://www.googleapis.com/auth/drive";
const help = `Usage: node scripts/google-drive-release.mjs <command> [options]
  authorize --env-file .env.local
  provision --env-file .env.local
  backup --env-file .env.local --output /safe/inf-backup
  verify-backup --backup /safe/inf-backup --scratch /scratch/inf-restore [--inventory inventory.json]
`;

function assertPermissionList(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} permission metadata is missing.`);
  for (const entry of value) if (!entry || typeof entry !== "object" || !entry.type || !entry.role) throw new Error(`${label} permission metadata is incomplete.`);
}

function isExpectedOwner(entry, ownerEmail) {
  return entry.type === "user" && entry.role === "owner" && entry.emailAddress?.toLowerCase() === ownerEmail.toLowerCase();
}

export function assertPermissionBoundary(publicPermissions, privatePermissions, testPermissions = privatePermissions, ownerEmail = EXPECTED_OWNER) {
  assertPermissionList(publicPermissions, "Public root");
  assertPermissionList(privatePermissions, "Private root");
  assertPermissionList(testPermissions, "Integration test root");
  const anyone = publicPermissions.filter((entry) => entry.type === "anyone");
  if (anyone.length !== 1 || anyone[0].role !== "reader" || anyone[0].allowFileDiscovery !== false) throw new Error("Public root must have exactly one anyone:reader permission with discovery disabled.");
  if (publicPermissions.length !== 2 || !publicPermissions.some((entry) => isExpectedOwner(entry, ownerEmail))) throw new Error("Public root permissions must be exact owner plus anyone:reader; unrelated access is forbidden.");
  for (const [label, entries] of [["Private root", privatePermissions], ["Integration test root", testPermissions]]) {
    if (entries.length !== 1 || !isExpectedOwner(entries[0], ownerEmail)) throw new Error(`${label} permissions must contain the expected owner only.`);
  }
}

export function runtimeFolderEnvironment(ids) {
  return {
    INF_PRIVATE_DRIVE_FOLDER_ID: ids.privateRoot, INF_EVENTS_FOLDER_ID: ids.events ?? ids.Events,
    INF_LIBRARY_FOLDER_ID: ids.Library, INF_THUMBNAILS_FOLDER_ID: ids.Thumbnails, INF_DUPLICATES_FOLDER_ID: ids.Duplicates,
  };
}

export function provisionFolderEnvironment(ids) {
  return {
    INF_PRIVATE_DRIVE_FOLDER_ID: ids.privateRoot,
    INF_LIBRARY_FOLDER_ID: ids.Library,
    INF_ARCHIVE_FOLDER_ID: ids.Archive,
    INF_DUPLICATES_FOLDER_ID: ids.Duplicates,
    INF_THUMBNAILS_FOLDER_ID: ids.Thumbnails,
    INF_EVENTS_FOLDER_ID: ids.events,
    INF_REVIEWS_FOLDER_ID: ids.reviews,
    INF_QUARANTINE_FOLDER_ID: ids.quarantine,
    INF_EXPORTS_FOLDER_ID: ids.exports,
    INF_DRIVE_TEST_ROOT_ID: ids.testRoot,
  };
}

export function createOAuthRequest(clientId, redirectUri, options = {}) {
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== "http:" || redirect.hostname !== "127.0.0.1" || redirect.pathname !== "/oauth/callback") throw new Error("OAuth redirect must use the exact loopback callback.");
  const state = options.state ?? randomBytes(32).toString("base64url");
  const verifier = options.verifier ?? randomBytes(64).toString("base64url");
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(state) || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) throw new Error("OAuth state and PKCE verifier must be cryptographically strong base64url values.");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [key, value] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope, access_type: "offline", prompt: "consent", state, code_challenge: challenge, code_challenge_method: "S256" })) url.searchParams.set(key, value);
  return { state, verifier, url: url.toString() };
}

function args(argv) {
  const result = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error(`Invalid argument ${argv[index] ?? ""}`);
    result[argv[index].slice(2)] = argv[index + 1];
  }
  return result;
}
function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/); if (match) values[match[1]] = match[2];
  }
  return values;
}
async function readEnv(path) { return parseEnv(await readFile(path, "utf8")); }
export async function updateEnvironmentFile(path, updates) {
  for (const [key, value] of Object.entries(updates)) {
    if (!/^[A-Z0-9_]+$/.test(key) || typeof value !== "string" || /[\r\n]/.test(value)) throw new Error(`Unsafe environment value for ${key}.`);
  }
  const current = await readFile(path, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
  const replaced = new Set();
  const lines = current.split(/\r?\n/).filter((line) => line.length > 0).map((line) => {
    const key = line.match(/^([A-Z0-9_]+)=/)?.[1]; if (!key || !(key in updates)) return line;
    replaced.add(key); return `${key}=${updates[key]}`;
  });
  for (const [key, value] of Object.entries(updates)) if (!replaced.has(key)) lines.push(`${key}=${value}`);
  await mkdir(dirname(resolve(path)), { recursive: true });
  const temporary = `${resolve(path)}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, `${lines.join("\n")}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, resolve(path));
    await chmod(resolve(path), 0o600);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}
const updateEnv = updateEnvironmentFile;
async function token(env) {
  for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]) if (!env[key]) throw new Error(`${key} is missing from the env file.`);
  const body = new globalThis.URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token" });
  const response = await globalThis.fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const value = await response.json(); if (!response.ok || !value.access_token) throw new Error("Google refresh-token exchange failed."); return value.access_token;
}
async function drive(accessToken, path, init = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`https://www.googleapis.com/drive/v3${path}`, { ...init, headers: { authorization: `Bearer ${accessToken}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
  if (!response.ok) throw new Error(`Drive API ${response.status} for ${path}: ${(await response.text()).slice(0, 300)}`);
  return response;
}

export async function exchangeAuthorizationCode({ clientId, clientSecret, code, verifier, redirectUri, fetchImpl = globalThis.fetch }) {
  const body = new globalThis.URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri });
  const response = await fetchImpl("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const value = await response.json();
  if (!response.ok || typeof value.access_token !== "string" || typeof value.refresh_token !== "string") throw new Error("OAuth code exchange did not return the required tokens.");
  if (typeof value.scope !== "string" || value.scope.length === 0 || value.scope.trim() !== value.scope || !/^[^\s]+(?: [^\s]+)*$/.test(value.scope)) throw new Error("OAuth code exchange returned missing or malformed granted scope metadata.");
  const grantedScopes = value.scope.split(" ");
  if (!grantedScopes.includes(scope)) throw new Error("OAuth authorization did not grant the required full Drive scope.");
  return { accessToken: value.access_token, refreshToken: value.refresh_token, grantedScopes };
}

export async function verifyDriveOwner(accessToken, expectedOwner = EXPECTED_OWNER, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)", { headers: { authorization: `Bearer ${accessToken}` } });
  const value = await response.json();
  const emailAddress = value?.user?.emailAddress;
  if (!response.ok || typeof emailAddress !== "string" || emailAddress.toLowerCase() !== expectedOwner.toLowerCase()) throw new Error("Drive owner verification failed.");
  return { emailAddress, displayName: typeof value.user.displayName === "string" ? value.user.displayName : "" };
}

export async function completeDriveAuthorization({ envFile, clientId, clientSecret, code, verifier, redirectUri, expectedOwner = EXPECTED_OWNER, fetchImpl = globalThis.fetch }) {
  const tokens = await exchangeAuthorizationCode({ clientId, clientSecret, code, verifier, redirectUri, fetchImpl });
  const owner = await verifyDriveOwner(tokens.accessToken, expectedOwner, fetchImpl);
  await updateEnvironmentFile(envFile, { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REFRESH_TOKEN: tokens.refreshToken });
  return { owner, grantedScopes: tokens.grantedScopes };
}

export async function createOAuthCallbackSession(expectedState, { timeoutMs = 300_000 } = {}) {
  if (typeof expectedState !== "string" || expectedState.length < 32) throw new Error("OAuth callback state is invalid.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new Error("OAuth callback timeout must be bounded to five minutes.");
  let settled = false;
  let finish;
  const code = new Promise((resolveCode, rejectCode) => {
    finish = {
      resolveCode: (value) => { if (!settled) { settled = true; resolveCode(value); } },
      rejectCode: (error) => { if (!settled) { settled = true; rejectCode(error); } },
    };
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const responseHeaders = { "cache-control": "no-store", connection: "close", "content-type": "text/plain; charset=utf-8" };
    if (request.method !== "GET" || url.pathname !== "/oauth/callback" || url.searchParams.get("state") !== expectedState || !url.searchParams.get("code") || url.searchParams.has("error")) {
      response.writeHead(400, responseHeaders).end("Authorization rejected.");
      finish.rejectCode(new Error("OAuth state/code validation failed."));
      return;
    }
    response.writeHead(200, responseHeaders).end("INF Drive authorization received. Return to the terminal.");
    finish.resolveCode(url.searchParams.get("code"));
  });
  const listening = new Promise((resolveListen, rejectListen) => {
    const failed = (error) => rejectListen(error);
    server.once("error", failed);
    server.listen(0, "127.0.0.1", () => { server.off("error", failed); resolveListen(); });
  });
  await listening;
  server.on("error", (error) => finish.rejectCode(error));
  const address = server.address();
  if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
    await new Promise((resolveClose) => server.close(resolveClose));
    throw new Error("OAuth callback did not bind to the required loopback address.");
  }
  const timer = globalThis.setTimeout(() => finish.rejectCode(new Error("OAuth callback timed out.")), timeoutMs);
  let closePromise;
  const close = () => {
    globalThis.clearTimeout(timer);
    if (closePromise) return closePromise;
    closePromise = new Promise((resolveClose, rejectClose) => {
      if (!server.listening) {
        server.closeAllConnections();
        resolveClose();
        return;
      }
      const shutdownTimer = globalThis.setTimeout(() => {
        server.closeAllConnections();
        resolveClose();
      }, 250);
      shutdownTimer.unref?.();
      server.close((error) => {
        globalThis.clearTimeout(shutdownTimer);
        if (error) rejectClose(error);
        else resolveClose();
      });
      server.closeIdleConnections();
      server.closeAllConnections();
    });
    return closePromise;
  };
  return { redirectUri: `http://127.0.0.1:${address.port}/oauth/callback`, code, close };
}

async function authorize(envFile) {
  const env = await readEnv(envFile); for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) if (!env[key]) throw new Error(`${key} is missing from ${envFile}.`);
  const state = randomBytes(32).toString("base64url");
  const callback = await createOAuthCallbackSession(state);
  try {
    const requestDetails = createOAuthRequest(env.GOOGLE_CLIENT_ID, callback.redirectUri, { state });
    process.stdout.write(`Open this owner-consent URL (full Drive scope is required for the existing shared root and manually uploaded files):\n${requestDetails.url}\n`);
    const authorizationCode = await callback.code;
    const { owner } = await completeDriveAuthorization({ envFile, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, code: authorizationCode, verifier: requestDetails.verifier, redirectUri: callback.redirectUri });
    process.stdout.write(`Drive owner ${owner.emailAddress} verified; credentials stored with mode 0600 in ${envFile}. Secret values were not printed.\n`);
  } finally { await callback.close(); }
}
async function list(accessToken, parentId) {
  const files = []; let pageToken;
  do {
    const query = new globalThis.URLSearchParams({ q: `'${parentId}' in parents and trashed=false`, fields: "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,size,md5Checksum,parents,appProperties)", pageSize: "1000" });
    if (pageToken) query.set("pageToken", pageToken);
    const value = await (await drive(accessToken, `/files?${query}`)).json(); files.push(...value.files); pageToken = value.nextPageToken;
  } while (pageToken);
  return files;
}

function exactParent(file, parentId, label) {
  if (!Array.isArray(file.parents) || file.parents.length !== 1 || file.parents[0] !== parentId) throw new Error(`${label} parent mismatch.`);
}

function exactOwnedFolder(file, { id, name, parentId, ownerEmail, label }) {
  if (!file || file.id !== id || file.name !== name || file.mimeType !== folderMimeType || file.trashed !== false) throw new Error(`${label} folder metadata mismatch.`);
  exactParent(file, parentId, label);
  if (!Array.isArray(file.owners) || file.owners.length !== 1 || file.owners[0]?.emailAddress?.toLowerCase() !== ownerEmail.toLowerCase()) throw new Error(`${label} owner mismatch.`);
}

async function selectOrCreateFolder(client, parentId, name, configuredId) {
  const matches = (await client.listChildren(parentId)).filter((entry) => entry.name === name);
  if (matches.length > 1) throw new Error(`Multiple ${name} entries exist under ${parentId}.`);
  if (configuredId) {
    let configured;
    try { configured = await client.getFile(configuredId); } catch { throw new Error(`Configured ${name} folder ID mismatch.`); }
    if (matches.length !== 1 || matches[0].id !== configuredId || configured.id !== configuredId || configured.name !== name || configured.mimeType !== folderMimeType || configured.trashed) throw new Error(`Configured ${name} folder ID mismatch.`);
    exactParent(configured, parentId, `Configured ${name}`);
    return configuredId;
  }
  if (matches.length === 1) {
    if (matches[0].mimeType !== folderMimeType || matches[0].trashed) throw new Error(`${name} exists but is not a live folder.`);
    exactParent(matches[0], parentId, name);
    return matches[0].id;
  }
  const created = await client.createFolder(name, parentId);
  if (!created || created.name !== name || created.mimeType !== folderMimeType || created.trashed || !created.id) throw new Error(`Drive did not confirm creation of ${name}.`);
  exactParent(created, parentId, name);
  return created.id;
}

export async function provisionWithClient(client, env = {}, { expectedOwner = EXPECTED_OWNER } = {}) {
  const about = await client.about();
  const actualOwner = about?.user?.emailAddress;
  if (typeof actualOwner !== "string" || actualOwner.toLowerCase() !== expectedOwner.toLowerCase()) throw new Error("Drive owner verification failed before provisioning.");

  const publicRoot = await client.getFile(PUBLIC_ROOT_ID);
  if (!publicRoot || publicRoot.id !== PUBLIC_ROOT_ID || publicRoot.name !== "INF-ASERDARGUN-COM" || publicRoot.mimeType !== folderMimeType || publicRoot.trashed !== false) throw new Error("Configured public root metadata mismatch.");
  if (!Array.isArray(publicRoot.parents) || publicRoot.parents.length !== 1 || !publicRoot.parents[0]) throw new Error("Configured public root parent metadata is missing or ambiguous.");
  if (!Array.isArray(publicRoot.owners) || publicRoot.owners.length !== 1 || publicRoot.owners[0]?.emailAddress?.toLowerCase() !== expectedOwner.toLowerCase()) throw new Error("Configured public root owner mismatch.");
  const siblingParentId = publicRoot.parents[0];

  let privateRoot;
  if (env.INF_PRIVATE_DRIVE_FOLDER_ID) {
    privateRoot = await selectOrCreateFolder(client, siblingParentId, "INF-PRIVATE-DATA", env.INF_PRIVATE_DRIVE_FOLDER_ID);
    exactOwnedFolder(await client.getFile(privateRoot), { id: privateRoot, name: "INF-PRIVATE-DATA", parentId: siblingParentId, ownerEmail: expectedOwner, label: "Configured private root" });
  } else {
    privateRoot = await selectOrCreateFolder(client, siblingParentId, "INF-PRIVATE-DATA");
    exactOwnedFolder(await client.getFile(privateRoot), { id: privateRoot, name: "INF-PRIVATE-DATA", parentId: siblingParentId, ownerEmail: expectedOwner, label: "Private root" });
  }

  const ids = { privateRoot };
  const configuredKey = {
    Library: "INF_LIBRARY_FOLDER_ID", Archive: "INF_ARCHIVE_FOLDER_ID", Duplicates: "INF_DUPLICATES_FOLDER_ID", Thumbnails: "INF_THUMBNAILS_FOLDER_ID",
    events: "INF_EVENTS_FOLDER_ID", reviews: "INF_REVIEWS_FOLDER_ID", quarantine: "INF_QUARANTINE_FOLDER_ID", exports: "INF_EXPORTS_FOLDER_ID",
  };
  for (const name of ["Library", "Archive", "Duplicates", "Thumbnails"]) {
    ids[name] = await selectOrCreateFolder(client, PUBLIC_ROOT_ID, name, env[configuredKey[name]]);
  }
  for (const name of ["events", "reviews", "quarantine", "exports"]) {
    ids[name] = await selectOrCreateFolder(client, privateRoot, name, env[configuredKey[name]]);
  }
  if (env.INF_DRIVE_TEST_ROOT_ID) {
    ids.testRoot = await selectOrCreateFolder(client, privateRoot, "integration-test", env.INF_DRIVE_TEST_ROOT_ID);
    exactOwnedFolder(await client.getFile(ids.testRoot), { id: ids.testRoot, name: "integration-test", parentId: privateRoot, ownerEmail: expectedOwner, label: "Configured integration test root" });
  } else {
    ids.testRoot = await selectOrCreateFolder(client, privateRoot, "integration-test");
    exactOwnedFolder(await client.getFile(ids.testRoot), { id: ids.testRoot, name: "integration-test", parentId: privateRoot, ownerEmail: expectedOwner, label: "Integration test root" });
  }

  assertPermissionBoundary(await client.permissions(PUBLIC_ROOT_ID), await client.permissions(privateRoot), await client.permissions(ids.testRoot), expectedOwner);
  return ids;
}

export function createProvisionClient(accessToken, fetchImpl = globalThis.fetch) {
  return {
    async about() { return (await (await drive(accessToken, "/about?fields=user(displayName,emailAddress)", {}, fetchImpl)).json()); },
    async getFile(id) { return (await (await drive(accessToken, `/files/${encodeURIComponent(id)}?fields=id,name,mimeType,trashed,parents,owners(emailAddress)`, {}, fetchImpl)).json()); },
    async listChildren(parentId) {
      const query = new globalThis.URLSearchParams({ q: `'${String(parentId).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' in parents and trashed=false`, fields: "nextPageToken,files(id,name,mimeType,trashed,parents,owners(emailAddress))", pageSize: "1000" });
      const files = [];
      let pageToken;
      do {
        if (pageToken) query.set("pageToken", pageToken); else query.delete("pageToken");
        const value = await (await drive(accessToken, `/files?${query}`, {}, fetchImpl)).json();
        if (!Array.isArray(value.files)) throw new Error("Drive child listing metadata is missing.");
        files.push(...value.files);
        pageToken = typeof value.nextPageToken === "string" && value.nextPageToken ? value.nextPageToken : undefined;
      } while (pageToken);
      return files;
    },
    async createFolder(name, parentId) {
      return (await (await drive(accessToken, "/files?fields=id,name,mimeType,trashed,parents,owners(emailAddress)", { method: "POST", body: JSON.stringify({ name, mimeType: folderMimeType, parents: [parentId] }) }, fetchImpl)).json());
    },
    async permissions(id) {
      const value = await (await drive(accessToken, `/files/${encodeURIComponent(id)}/permissions?fields=permissions(id,type,role,emailAddress,domain,allowFileDiscovery)`, {}, fetchImpl)).json();
      return value.permissions;
    },
  };
}

async function provision(envFile) {
  const env = await readEnv(envFile); const accessToken = await token(env);
  const ids = await provisionWithClient(createProvisionClient(accessToken), env);
  const persisted = provisionFolderEnvironment(ids);
  await updateEnv(envFile, persisted);
  process.stdout.write(`${JSON.stringify({ publicRoot: PUBLIC_ROOT_ID, ...persisted, permissionBoundary: "public exact owner+anyone:reader; private and integration-test owner-only" }, null, 2)}\n`);
}
const safeName = (name) => name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "file";
async function backup(envFile, output) {
  const env = await readEnv(envFile); const accessToken = await token(env); const target = resolve(output);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await mkdir(target, { recursive: false, mode: 0o700 }); const manifest = [];
  async function walk(rootLabel, folderId, relativePath = "") {
    for (const entry of await list(accessToken, folderId)) {
      if (entry.mimeType === "application/vnd.google-apps.folder") { await walk(rootLabel, entry.id, join(relativePath, safeName(entry.name))); continue; }
      const path = join("data", rootLabel, relativePath, `${entry.id}-${safeName(entry.name)}`); const absolute = join(target, path); await mkdir(dirname(absolute), { recursive: true });
      const bytes = Buffer.from(await (await drive(accessToken, `/files/${entry.id}?alt=media`)).arrayBuffer()); await writeFile(absolute, bytes, { flag: "wx", mode: 0o600 });
      manifest.push({ ...entry, root: rootLabel, relativePath: path, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  }
  await walk("public", PUBLIC_ROOT_ID); await walk("private", env.INF_PRIVATE_DRIVE_FOLDER_ID || (() => { throw new Error("INF_PRIVATE_DRIVE_FOLDER_ID is missing."); })());
  manifest.sort((a, b) => a.relativePath.localeCompare(b.relativePath)); await writeFile(join(target, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), roots: { public: PUBLIC_ROOT_ID, private: env.INF_PRIVATE_DRIVE_FOLDER_ID }, files: manifest }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`Backed up ${manifest.length} files to ${target}; manifest includes exact SHA-256 values.\n`);
}
async function verifyBackup(backupPath, scratchPath, inventoryPath) {
  const source = resolve(backupPath); const scratch = resolve(scratchPath); await stat(join(source, "manifest.json"));
  const existing = await stat(scratch).then(() => true, (error) => error.code === "ENOENT" ? false : Promise.reject(error)); if (existing) throw new Error(`Scratch restore target already exists: ${scratch}`);
  await mkdir(dirname(scratch), { recursive: true, mode: 0o700 }); await cp(source, scratch, { recursive: true, errorOnExist: true, force: false });
  const manifest = JSON.parse(await readFile(join(scratch, "manifest.json"), "utf8"));
  for (const entry of manifest.files) { const bytes = await readFile(join(scratch, entry.relativePath)); if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error(`Scratch restore hash mismatch: ${entry.relativePath}`); }
  const events = [];
  for (const entry of manifest.files.filter((file) => file.root === "private" && file.mimeType === "application/json")) { try { const value = JSON.parse(await readFile(join(scratch, entry.relativePath), "utf8")); if (value?.schemaVersion === 1 && value?.eventId) events.push(value); } catch { /* non-event JSON is not folded */ } }
  // The documented command is valid immediately after Setup. Build only the
  // exact ignored runtime prerequisites before importing the workspace export.
  await execFile(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--filter", "@inf/contracts", "build"], { maxBuffer: 10 * 1024 * 1024 });
  await execFile(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--filter", "@inf/domain", "build"], { maxBuffer: 10 * 1024 * 1024 });
  const { foldEvents } = await import("@inf/domain"); const folded = foldEvents(events); const recovered = folded.catalog.infographics.map((item) => ({ id: item.id, title: item.title, originalDriveFileId: item.originalDriveFileId, thumbnailDriveFileId: item.thumbnailDriveFileId, sha256: item.sha256, folderState: item.folderState })).sort((a, b) => a.id.localeCompare(b.id));
  if (inventoryPath) {
    const exported = JSON.parse(await readFile(resolve(inventoryPath), "utf8")); const expected = (exported.recovery?.items ?? exported.items ?? []).map(({ id, title, originalDriveFileId, thumbnailDriveFileId, sha256, folderState }) => ({ id, title, originalDriveFileId, thumbnailDriveFileId, sha256, folderState })).sort((a, b) => a.id.localeCompare(b.id));
    if (JSON.stringify(recovered) !== JSON.stringify(expected)) throw new Error("Folded scratch inventory differs from the Settings export.");
  }
  await writeFile(join(scratch, "folded-inventory.json"), `${JSON.stringify({ items: recovered, quarantine: folded.quarantine }, null, 2)}\n`, { mode: 0o600 }); process.stdout.write(`Verified ${manifest.files.length} restored files and folded ${events.length} immutable events in ${scratch}.\n`);
}

export async function runDriveReleaseEntrypoint(command, envFile = ".env.local") {
  if (command === "authorize") return authorize(envFile);
  if (command === "provision") return provision(envFile);
  throw new Error(`Unsupported Drive release entrypoint: ${command}`);
}

async function main() {
  const options = args(process.argv.slice(2));
  if (!options.command || options.command === "--help" || options.command === "help") { process.stdout.write(help); return; }
  if (options.command === "authorize" && options["env-file"]) return authorize(options["env-file"]);
  if (options.command === "provision" && options["env-file"]) return provision(options["env-file"]);
  if (options.command === "backup" && options["env-file"] && options.output) return backup(options["env-file"], options.output);
  if (options.command === "verify-backup" && options.backup && options.scratch) return verifyBackup(options.backup, options.scratch, options.inventory);
  throw new Error(`Invalid command/options.\n${help}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
