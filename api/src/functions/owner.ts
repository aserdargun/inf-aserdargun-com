import { randomUUID } from "node:crypto";
import { AiSuggestionSchema, CaptureMetadataSchema, ConfirmDeleteSchema, InfEventSchema, InfographicPatchSchema, OwnerCatalogQuerySchema, ReviewRequestSchema, SettingsHealthResponseSchema, SyncRequestSchema, type Category, type OwnerCatalogQuery } from "@inf/contracts";
import { foldEvents } from "@inf/domain";
import { authorizeOwner } from "../auth/authorize.js";
import { AppError, emptyResponse, errorResponse, jsonResponse, type HttpResponse } from "../http/errors.js";
import { optionalFormString, parseJson, parseMultipart, uuidPath, type RequestLike } from "../http/parse.js";
import { CaptureService } from "../services/capture-service.js";
import { ImageProcessingError } from "../images/process-image.js";
import { CatalogService, type CatalogSnapshot } from "../services/catalog-service.js";
import { ImageReplaceService } from "../services/image-replace-service.js";
import { OpenAiService, openAiServiceFromEnv } from "../services/openai-service.js";
import { ReviewService } from "../services/review-service.js";
import type { EventStore } from "../storage/event-store.js";
import type { StoragePort } from "../storage/storage-port.js";
import type { AutoTrimConfig } from "../images/trim-options.js";

export interface OwnerDependencies {
  storage: StoragePort;
  events: Pick<EventStore, "readAll" | "append">;
  publicRootId: string;
  privateRootId: string;
  eventsFolderId: string;
  libraryFolderId: string;
  thumbnailsFolderId: string;
  duplicatesFolderId: string;
  allowedGithubUser: string | undefined;
  localAuthBypass?: string;
  azureSiteName?: string;
  localProxyMode?: string;
  expectedLocalProxyToken?: string;
  now?: () => Date;
  uuid?: () => string;
  /** Optional injected AI service; if absent the handler returns 503. */
  openAiService?: OpenAiService | null;
  /** Auto-trim configuration for capture/replace. Defaults to disabled when absent. */
  trim?: AutoTrimConfig;
}

const metadataKeys = ["title", "notes"] as const;

function now(deps: OwnerDependencies): Date { return (deps.now ?? (() => new Date()))(); }
function uuid(deps: OwnerDependencies): string { return (deps.uuid ?? randomUUID)(); }

function authorize(request: RequestLike, deps: OwnerDependencies) {
  const decision = authorizeOwner({
    encodedPrincipal: request.headers.get("x-ms-client-principal"), allowedGithubUser: deps.allowedGithubUser, requestUrl: request.url,
    localAuthBypass: deps.localAuthBypass, azureSiteName: deps.azureSiteName, localProxyMode: deps.localProxyMode,
    expectedLocalProxyToken: deps.expectedLocalProxyToken, presentedLocalProxyToken: request.headers.get("x-inf-local-proxy-token"),
  });
  if (!decision.authorized) throw new AppError("UNAUTHORIZED", decision.status, decision.status === 401 ? "Authentication is required" : "Owner access is required");
  return decision;
}

function httpError(error: unknown): AppError | unknown {
  if (!(error instanceof ImageProcessingError)) return error;
  const status = error.code === "IMAGE_TOO_LARGE" ? 413
    : error.code === "UNSUPPORTED_MIME" || error.code === "UNSUPPORTED_IMAGE_FORMAT" || error.code === "MIME_MISMATCH" ? 415
      : 400;
  return new AppError(error.code, status, error.message);
}

function aiHttpError(error: unknown): AppError | unknown {
  if (!(error instanceof AppError)) return error;
  switch (error.code) {
    case "AI_NOT_CONFIGURED": return new AppError(error.code, 503, error.message);
    case "AI_TIMEOUT":
    case "AI_UNREACHABLE":
    case "AI_UPSTREAM_ERROR": return new AppError(error.code, 504, error.message);
    case "AI_RATE_LIMITED": return new AppError(error.code, 429, error.message);
    case "AI_UNAUTHORIZED": return new AppError(error.code, 502, error.message);
    case "AI_REFUSAL": return new AppError(error.code, 422, error.message);
    case "AI_BAD_REQUEST": return new AppError(error.code, 400, error.message);
    case "UNSUPPORTED_MIME": return new AppError(error.code, 415, error.message);
    case "IMAGE_TOO_LARGE": return new AppError(error.code, 413, error.message);
    case "INVALID_IMAGE_INPUT": return new AppError(error.code, 400, error.message);
    case "AI_BAD_JSON":
    case "AI_BAD_SHAPE":
    case "AI_BAD_RESPONSE":
    case "AI_EMPTY_RESPONSE": return new AppError(error.code, 502, error.message);
    default: return error;
  }
}

async function authorized(
  request: RequestLike,
  deps: OwnerDependencies,
  action: (mode: "github" | "local-bypass") => Promise<HttpResponse>,
): Promise<HttpResponse> {
  try {
    const decision = authorize(request, deps);
    return await action(decision.mode);
  } catch (error) { return errorResponse(httpError(error)); }
}

async function authorizedAi(
  request: RequestLike,
  deps: OwnerDependencies,
  action: (mode: "github" | "local-bypass") => Promise<HttpResponse>,
): Promise<HttpResponse> {
  try {
    const decision = authorize(request, deps);
    return await action(decision.mode);
  } catch (error) { return errorResponse(aiHttpError(httpError(error))); }
}

async function owner(request: RequestLike, deps: OwnerDependencies, action: (snapshot: CatalogSnapshot, mode: "github" | "local-bypass") => Promise<HttpResponse>): Promise<HttpResponse> {
  return authorized(request, deps, async (mode) => {
    // All catalog endpoint paths take one snapshot at most; mutation handlers use this single snapshot for existence/interval decisions.
    return action(await new CatalogService(deps.events).snapshot(), mode);
  });
}

function event(deps: OwnerDependencies, type: string, infographicId: string, payload: unknown) {
  return InfEventSchema.parse({ eventId: uuid(deps), schemaVersion: 1, type, occurredAt: now(deps).toISOString(), infographicId, payload });
}

function catalogQuery(request: RequestLike): OwnerCatalogQuery | undefined {
  let params: URLSearchParams;
  try { params = new URL(request.url).searchParams; } catch { throw new AppError("INVALID_QUERY", 400, "Catalog query is invalid"); }
  if ([...params].length === 0) return undefined;
  const raw: Record<string, string> = {};
  for (const [key, value] of params) {
    if (key in raw) throw new AppError("INVALID_QUERY", 400, "Catalog query is invalid");
    raw[key] = value;
  }
  const parsed = OwnerCatalogQuerySchema.safeParse(raw);
  if (!parsed.success) throw new AppError("INVALID_QUERY", 400, "Catalog query is invalid");
  return parsed.data;
}

export function ownerSession(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return owner(request, deps, async (_snapshot, mode) => jsonResponse({ authenticated: true, owner: deps.allowedGithubUser, mode }));
}

export function ownerList(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return owner(request, deps, async (snapshot) => {
    const query = catalogQuery(request);
    const catalog = new CatalogService(deps.events);
    if (query === undefined) {
      // No query at all: callers (e.g. the Today page) want every non-deleted item in a single payload and apply their own filter on top. Pagination is opt-in via ?page=... so the legacy response shape stays backward compatible.
      return jsonResponse({ infographics: snapshot.infographics, categories: snapshot.catalog.categories, tags: snapshot.catalog.tags });
    }
    const page = catalog.libraryList(snapshot, query);
    return jsonResponse({ infographics: page.items, categories: snapshot.catalog.categories, tags: snapshot.catalog.tags, page: page.page, pageSize: page.pageSize, totalItems: page.totalItems, totalPages: page.totalPages });
  });
}

export function ownerGet(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return owner(request, deps, async (snapshot) => {
    const id = uuidPath(request, "/api/infographics/");
    return jsonResponse(new CatalogService(deps.events).item(snapshot, id));
  });
}

export function ownerSync(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return owner(request, deps, async () => {
    const input = await parseJson(request, SyncRequestSchema);
    return jsonResponse({ imported: 0, duplicates: 0, rejected: 0 });
  });
}

export function ownerPatch(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return owner(request, deps, async (snapshot) => {
    const id = uuidPath(request, "/api/infographics/"); const item = new CatalogService(deps.events).item(snapshot, id);
    const patch = await parseJson(request, InfographicPatchSchema);
    const metadata = Object.fromEntries(metadataKeys.filter((key) => patch[key] !== undefined).map((key) => [key, patch[key]]));
    if (Object.keys(metadata).length > 0) await deps.events.append(event(deps, "infographic.metadataUpdated", id, metadata));
    if (patch.favorite !== undefined) await deps.events.append(event(deps, "infographic.favoriteChanged", id, { favorite: patch.favorite }));
    if (patch.archived !== undefined) {
      if (!patch.archived) throw new AppError("INVALID_BODY", 400, "Archived infographics cannot be restored by this API");
      await deps.events.append(event(deps, "infographic.archived", id, {}));
    }
    if (patch.categories !== undefined) await assignCategories(deps, item, patch.categories);
    if (patch.tags !== undefined) await deps.events.append(event(deps, "infographic.tagsAssigned", id, { tags: patch.tags }));
    return jsonResponse({ updated: true });
  });
}

export function ownerDelete(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return owner(request, deps, async (snapshot) => {
    const id = uuidPath(request, "/api/infographics/"); const item = new CatalogService(deps.events).item(snapshot, id);
    await parseJson(request, ConfirmDeleteSchema);
    await deps.storage.trashFile(item.originalDriveFileId); await deps.storage.trashFile(item.thumbnailDriveFileId);
    await deps.events.append(event(deps, "infographic.deleted", id, {}));
    return emptyResponse();
  });
}

export function ownerReplaceImage(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return authorized(request, deps, async () => {
    const id = uuidPath({ ...request, url: request.url.replace(/\/image$/, "") }, "/api/infographics/");
    const snapshot = await new CatalogService(deps.events).snapshot();
    const item = new CatalogService(deps.events).item(snapshot, id);
    if (item.archived) throw new AppError("ARCHIVED", 409, "Archived infographics cannot be replaced");
    const form = await parseMultipart(request);
    const file = form.get("file");
    if (!file || typeof file === "string" || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function" || !file.type) {
      throw new AppError("INVALID_MULTIPART", 400, "Multipart image file is required");
    }
    const service = new ImageReplaceService({ storage: deps.storage, events: deps.events as EventStore, publicRootId: deps.publicRootId, libraryFolderId: deps.libraryFolderId, thumbnailsFolderId: deps.thumbnailsFolderId, now: () => now(deps), uuid: () => uuid(deps), trim: deps.trim });
    const result = await service.replace({ infographicId: id, bytes: Buffer.from(await file.arrayBuffer()), declaredMime: file.type, name: file.name });
    return jsonResponse(result.infographic, 200);
  });
}

export function ownerSuggestForInfographic(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return authorizedAi(request, deps, async () => {
    const service = deps.openAiService ?? openAiServiceFromEnv();
    if (!service) throw new AppError("AI_NOT_CONFIGURED", 503, "AI suggestions are not configured on the server.");
    const id = uuidPath({ ...request, url: request.url.replace(/\/suggest$/, "") }, "/api/infographics/");
    const snapshot = await new CatalogService(deps.events).snapshot();
    const item = new CatalogService(deps.events).item(snapshot, id);
    let bytes: Buffer;
    try { bytes = await deps.storage.readFile(item.thumbnailDriveFileId); }
    catch { throw new AppError("THUMBNAIL_UNAVAILABLE", 502, "Thumbnail bytes could not be read for AI suggestion"); }
    const existingCategories = snapshot.catalog.categories.map((entry) => entry.displayName);
    const response = await service.suggestMetadata({ bytes, declaredMime: "image/webp", existingCategories });
    return jsonResponse(AiSuggestionSchema.parse({ suggestion: response.suggestion }), 200);
  });
}

export function ownerSeen(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return owner(request, deps, async (snapshot) => {
    const id = uuidPath({ ...request, url: request.url.replace(/\/seen$/, "") }, "/api/infographics/"); new CatalogService(deps.events).item(snapshot, id);
    await deps.events.append(event(deps, "infographic.seen", id, {})); return emptyResponse();
  });
}

export function ownerReview(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return owner(request, deps, async (snapshot) => {
    const id = uuidPath({ ...request, url: request.url.replace(/\/reviews$/, "") }, "/api/infographics/"); const input = await parseJson(request, ReviewRequestSchema);
    return jsonResponse(await new ReviewService(deps.events as EventStore, { now: () => now(deps), uuid: () => uuid(deps) }).record(snapshot, id, input.rating));
  });
}

export function ownerSurprise(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return owner(request, deps, async (snapshot) => {
    const infographic = new CatalogService(deps.events).surprise(snapshot, deps.allowedGithubUser ?? "", now(deps));
    if (infographic) await deps.events.append(event(deps, "infographic.seen", infographic.id, {}));
    return jsonResponse({ infographic });
  });
}

export function ownerDueReview(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return owner(request, deps, async (snapshot) => jsonResponse({ infographics: new CatalogService(deps.events).due(snapshot, now(deps)) }));
}

export function ownerStats(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return owner(request, deps, async (snapshot) => jsonResponse(new CatalogService(deps.events).stats(snapshot, now(deps))));
}

/** Projects operational recovery data through an explicit owner-only allowlist. */
export function ownerSettingsHealth(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return owner(request, deps, async (snapshot) => {
    const catalog = new CatalogService(deps.events);
    const [publicDrive, privateDrive] = await Promise.all([
      driveHealth(deps, deps.publicRootId, [
        [deps.libraryFolderId, "Library"], [deps.thumbnailsFolderId, "Thumbnails"], [deps.duplicatesFolderId, "Duplicates"],
      ]),
      driveHealth(deps, deps.privateRootId, [[deps.eventsFolderId, "Events"]]),
    ]);
    const reasonCounts = new Map<string, number>();
    for (const entry of snapshot.catalog.rejectedFiles) reasonCounts.set(entry.reason, (reasonCounts.get(entry.reason) ?? 0) + 1);
    const rawEvents = await deps.events.readAll();
    // The separate fold keeps an invalid event count without returning the raw malformed event body.
    const { quarantine } = foldEvents(rawEvents);
    for (const entry of quarantine) reasonCounts.set(entry.reason, (reasonCounts.get(entry.reason) ?? 0) + 1);
    const response = {
      schemaVersion: 1 as const,
      application: { name: "Infographics" as const, version: "0.1.0", runtimeVersion: process.version, usesAi: process.env.OPENAI_API_KEY !== undefined && process.env.OPENAI_API_KEY.length > 0 },
      connectionHealth: { publicDrive, privateDrive },
      data: catalog.stats(snapshot, now(deps)),
      quarantine: {
        count: snapshot.catalog.rejectedFiles.length + quarantine.length,
        reasons: [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => a.reason.localeCompare(b.reason)),
        rejectedFiles: snapshot.catalog.rejectedFiles.map((entry) => ({ ...entry })).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId)),
      },
      recovery: {
        inventorySchemaVersion: 1 as const,
        items: [...snapshot.infographics].sort((a, b) => a.id.localeCompare(b.id)).map((item) => ({
          id: item.id, title: item.title, originalDriveFileId: item.originalDriveFileId, thumbnailDriveFileId: item.thumbnailDriveFileId,
          sha256: item.sha256, detectedMimeType: item.detectedMimeType, width: item.width, height: item.height, folderState: item.folderState,
          createdAt: item.createdAt, capturedAt: item.capturedAt, processedAt: item.processedAt, lastSeenAt: item.lastSeenAt,
        })),
      },
    };
    return jsonResponse(SettingsHealthResponseSchema.parse(response));
  });
}

async function driveHealth(deps: OwnerDependencies, rootId: string, configuredFolders: readonly (readonly [string, string])[]) {
  const rootHealthy = await folderHealthy(deps.storage, rootId, rootId);
  const folders = await Promise.all(configuredFolders.map(async ([id, label]) => ({ id, label, healthy: await folderHealthy(deps.storage, id, rootId) })));
  return { rootId, folderUrl: `https://drive.google.com/drive/folders/${encodeURIComponent(rootId)}`, healthy: rootHealthy && folders.every((folder) => folder.healthy), folders };
}

async function folderHealthy(storage: StoragePort, folderId: string, rootId: string): Promise<boolean> {
  try { return await storage.isDescendant(folderId, rootId) && (await storage.listChildren(folderId), true); }
  catch { return false; }
}

export function ownerCapture(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  // Parse the bounded request before EventStore/CaptureService work so rejected payloads have no storage/event side effects.
  return authorized(request, deps, async () => {
    const form = await parseMultipart(request); const file = form.get("file");
    if (!file || typeof file === "string" || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function" || !file.type) throw new AppError("INVALID_MULTIPART", 400, "Multipart image file is required");
    const categoriesRaw = optionalFormString(form, "categories");
    const tagsRaw = optionalFormString(form, "tags");
    const cropRaw = optionalFormString(form, "crop");
    const metadataResult = CaptureMetadataSchema.safeParse({
      title: optionalFormString(form, "title"),
      notes: optionalFormString(form, "notes"),
      ...(categoriesRaw === undefined ? {} : { categories: parseJsonArray(categoriesRaw, "categories") }),
      ...(tagsRaw === undefined ? {} : { tags: parseJsonArray(tagsRaw, "tags") }),
    });
    if (!metadataResult.success) throw new AppError("INVALID_MULTIPART", 400, "Multipart metadata is invalid");
    const metadata = metadataResult.data;
    const crop = parseOptionalCrop(cropRaw);
    const captured = await new CaptureService({ storage: deps.storage, events: deps.events as EventStore, publicRootId: deps.publicRootId, libraryFolderId: deps.libraryFolderId, thumbnailsFolderId: deps.thumbnailsFolderId, now: () => now(deps), uuid: () => uuid(deps), trim: deps.trim }).capture({ bytes: Buffer.from(await file.arrayBuffer()), declaredMime: file.type, name: file.name, ...metadata, crop });
    return jsonResponse(captured, captured.kind === "created" ? 201 : 200);
  });
}

/**
 * Parse the optional AI-suggested crop box from a multipart part. Returns
 * `null` when the part is absent, an empty string, malformed JSON, or a
 * shape that cannot be turned into a valid 0-1 box. The capture service
 * re-validates the box, so a bad value here simply falls back to the
 * per-pixel auto-trim rather than rejecting the whole capture.
 */
function parseOptionalCrop(raw: string | undefined): { top: number; right: number; bottom: number; left: number } | null {
  if (raw === undefined || raw.trim() === "") return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const c = parsed as Record<string, unknown>;
  const top = typeof c.top === "number" && Number.isFinite(c.top) ? c.top : NaN;
  const right = typeof c.right === "number" && Number.isFinite(c.right) ? c.right : NaN;
  const bottom = typeof c.bottom === "number" && Number.isFinite(c.bottom) ? c.bottom : NaN;
  const left = typeof c.left === "number" && Number.isFinite(c.left) ? c.left : NaN;
  if (![top, right, bottom, left].every((v) => Number.isFinite(v))) return null;
  return { top, right, bottom, left };
}

/**
 * Parse a JSON-encoded array field from the multipart body. The capture form
 * ships categories and tags as JSON strings because multipart parts cannot
 * carry structured objects directly. Anything malformed is rejected as
 * `INVALID_MULTIPART` so the owner sees the real cause instead of a silent
 * drop.
 */
function parseJsonArray<T>(raw: string, field: "categories" | "tags"): T[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new AppError("INVALID_MULTIPART", 400, `${field} field is not valid JSON`); }
  if (!Array.isArray(parsed)) throw new AppError("INVALID_MULTIPART", 400, `${field} field must be a JSON array`);
  return parsed as T[];
}

/** Owner-only AI metadata suggestion. Returns a structured response derived from the uploaded image. */
export function ownerSuggestMetadata(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return authorizedAi(request, deps, async () => {
    const service = deps.openAiService ?? openAiServiceFromEnv();
    if (!service) throw new AppError("AI_NOT_CONFIGURED", 503, "AI suggestions are not configured on the server.");
    const form = await parseMultipart(request); const file = form.get("file");
    if (!file || typeof file === "string" || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function" || !file.type) throw new AppError("INVALID_MULTIPART", 400, "Multipart image file is required");
    const bytes = Buffer.from(await file.arrayBuffer());
    const suggestion = await service.suggestMetadata({ bytes, declaredMime: file.type, ...(file.name ? { filename: file.name } : {}) });
    return jsonResponse(suggestion, 200);
  });
}

async function assignCategories(
  deps: OwnerDependencies,
  item: CatalogSnapshot["infographics"][number],
  categories: Category[],
): Promise<void> {
  // New uploads land in Library directly, so the historical
  // Inbox→Library move is gone. The PATCH path now only appends the
  // assignment event; later edits to the same item just re-run this with
  // a new category list. Archived items stay in their archive folder and
  // uncategorized Library items are filtered client-side on the Today page.
  await deps.events.append(event(deps, "infographic.categoriesAssigned", item.id, { categories }));
}
