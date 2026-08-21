import { createHash, randomBytes } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { createServer } from "node:http";
import { chmod, cp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const PUBLIC_ROOT_ID = "1wijWSRvrjEZ3y78bKsAQS8mOP0OPvgsK";
const scope = "https://www.googleapis.com/auth/drive";
const help = `Usage: node scripts/google-drive-release.mjs <command> [options]
  authorize --env-file .env.local
  provision --env-file .env.local
  backup --env-file .env.local --output /safe/inf-backup
  verify-backup --backup /safe/inf-backup --scratch /scratch/inf-restore [--inventory inventory.json]
`;

export function assertPermissionBoundary(publicPermissions, privatePermissions) {
  const anyone = publicPermissions.filter((entry) => entry.type === "anyone");
  if (anyone.length !== 1 || anyone[0].role !== "reader") throw new Error("Public root must have exactly one anyone:reader permission.");
  if (privatePermissions.some((entry) => entry.type === "anyone" || entry.type === "domain")) throw new Error("Private root must not have anyone or domain permissions.");
}

export function runtimeFolderEnvironment(ids) {
  return {
    INF_PRIVATE_DRIVE_FOLDER_ID: ids.privateRoot, INF_EVENTS_FOLDER_ID: ids.Events, INF_INBOX_FOLDER_ID: ids.Inbox,
    INF_LIBRARY_FOLDER_ID: ids.Library, INF_THUMBNAILS_FOLDER_ID: ids.Thumbnails, INF_DUPLICATES_FOLDER_ID: ids.Duplicates,
  };
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
async function updateEnv(path, updates) {
  const current = await readFile(path, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
  const replaced = new Set();
  const lines = current.split(/\r?\n/).filter((line) => line.length > 0).map((line) => {
    const key = line.match(/^([A-Z0-9_]+)=/)?.[1]; if (!key || !(key in updates)) return line;
    replaced.add(key); return `${key}=${updates[key]}`;
  });
  for (const [key, value] of Object.entries(updates)) if (!replaced.has(key)) lines.push(`${key}=${value}`);
  await mkdir(dirname(resolve(path)), { recursive: true });
  const temporary = `${resolve(path)}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, `${lines.join("\n")}\n`, { mode: 0o600, flag: "wx" }); await rename(temporary, resolve(path)); await chmod(resolve(path), 0o600);
}
async function token(env) {
  for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]) if (!env[key]) throw new Error(`${key} is missing from the env file.`);
  const body = new globalThis.URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token" });
  const response = await globalThis.fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const value = await response.json(); if (!response.ok || !value.access_token) throw new Error("Google refresh-token exchange failed."); return value.access_token;
}
async function drive(accessToken, path, init = {}) {
  const response = await globalThis.fetch(`https://www.googleapis.com/drive/v3${path}`, { ...init, headers: { authorization: `Bearer ${accessToken}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
  if (!response.ok) throw new Error(`Drive API ${response.status} for ${path}: ${(await response.text()).slice(0, 300)}`);
  return response;
}
async function authorize(envFile) {
  const env = await readEnv(envFile); for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) if (!env[key]) throw new Error(`${key} is missing from ${envFile}.`);
  const state = randomBytes(24).toString("base64url");
  let finish; const code = new Promise((resolveCode, rejectCode) => { finish = { resolveCode, rejectCode }; });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.searchParams.get("state") !== state || !url.searchParams.get("code")) { response.writeHead(400).end("Authorization rejected."); finish.rejectCode(new Error("OAuth state/code validation failed.")); return; }
    response.end("INF Drive authorization received. Return to the terminal."); finish.resolveCode(url.searchParams.get("code"));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address(); const redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [key, value] of Object.entries({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope, access_type: "offline", prompt: "consent", state })) url.searchParams.set(key, value);
  process.stdout.write(`Open this owner-consent URL (full Drive scope is required for the existing shared root and manually uploaded files):\n${url}\n`);
  const timer = globalThis.setTimeout(() => finish.rejectCode(new Error("OAuth callback timed out.")), 300_000);
  try {
    const authorizationCode = await code;
    const body = new globalThis.URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code: authorizationCode, grant_type: "authorization_code", redirect_uri: redirectUri });
    const response = await globalThis.fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    const value = await response.json(); if (!response.ok || !value.refresh_token) throw new Error("OAuth code exchange did not return a refresh token.");
    await updateEnv(envFile, { GOOGLE_REFRESH_TOKEN: value.refresh_token }); process.stdout.write(`Refresh token stored with mode 0600 in ${envFile}; token value was not printed.\n`);
  } finally { globalThis.clearTimeout(timer); await new Promise((resolveClose) => server.close(resolveClose)); }
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
async function folder(accessToken, parentId, name) {
  const matches = (await list(accessToken, parentId)).filter((entry) => entry.name === name && entry.mimeType === "application/vnd.google-apps.folder");
  if (matches.length > 1) throw new Error(`Multiple ${name} folders exist under ${parentId}.`);
  if (matches.length === 1) return matches[0].id;
  const value = await (await drive(accessToken, "/files?fields=id,name,parents", { method: "POST", body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }) })).json(); return value.id;
}
async function provision(envFile) {
  const env = await readEnv(envFile); const accessToken = await token(env);
  await drive(accessToken, `/files/${PUBLIC_ROOT_ID}?fields=id,name,mimeType,trashed`);
  let privateRoot = env.INF_PRIVATE_DRIVE_FOLDER_ID;
  if (!privateRoot) {
    const value = await (await drive(accessToken, "/files?fields=id,name,parents", { method: "POST", body: JSON.stringify({ name: "INF-PRIVATE-DATA", mimeType: "application/vnd.google-apps.folder" }) })).json(); privateRoot = value.id;
  }
  const ids = { privateRoot };
  for (const name of ["Inbox", "Library", "Archive", "Duplicates", "Thumbnails"]) ids[name] = await folder(accessToken, PUBLIC_ROOT_ID, name);
  for (const name of ["Events", "Reviews", "Quarantine", "Exports"]) ids[name] = await folder(accessToken, privateRoot, name);
  const permissions = async (id) => (await (await drive(accessToken, `/files/${id}/permissions?fields=permissions(id,type,role,emailAddress,domain)`)).json()).permissions ?? [];
  assertPermissionBoundary(await permissions(PUBLIC_ROOT_ID), await permissions(privateRoot));
  await updateEnv(envFile, runtimeFolderEnvironment(ids));
  process.stdout.write(`${JSON.stringify({ publicRoot: PUBLIC_ROOT_ID, ...runtimeFolderEnvironment(ids), permissionBoundary: "public anyone:reader; private restricted" }, null, 2)}\n`);
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
