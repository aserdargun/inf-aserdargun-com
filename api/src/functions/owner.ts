import { randomUUID } from "node:crypto";
import { CaptureMetadataSchema, ConfirmDeleteSchema, InfEventSchema, InfographicPatchSchema, ReviewRequestSchema, SyncRequestSchema, type Category } from "@inf/contracts";
import { authorizeOwner } from "../auth/authorize.js";
import { AppError, emptyResponse, errorResponse, jsonResponse, type HttpResponse } from "../http/errors.js";
import { optionalFormString, parseJson, parseMultipart, uuidPath, type RequestLike } from "../http/parse.js";
import { CaptureService } from "../services/capture-service.js";
import { ImageProcessingError } from "../images/process-image.js";
import { CatalogService, type CatalogSnapshot } from "../services/catalog-service.js";
import { ReviewService } from "../services/review-service.js";
import { SyncService } from "../services/sync-service.js";
import type { EventStore } from "../storage/event-store.js";
import type { StoragePort } from "../storage/storage-port.js";

export interface OwnerDependencies {
  storage: StoragePort;
  events: Pick<EventStore, "readAll" | "append">;
  publicRootId: string;
  privateRootId: string;
  eventsFolderId: string;
  inboxFolderId: string;
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
}

const metadataKeys = ["title", "notes", "sourceUrl", "sourcePlatform", "sourceAuthor"] as const;

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

async function owner(request: RequestLike, deps: OwnerDependencies, action: (snapshot: CatalogSnapshot, mode: "github" | "local-bypass") => Promise<HttpResponse>): Promise<HttpResponse> {
  return authorized(request, deps, async (mode) => {
    // All catalog endpoint paths take one snapshot at most; mutation handlers use this single snapshot for existence/interval decisions.
    return action(await new CatalogService(deps.events).snapshot(), mode);
  });
}

function event(deps: OwnerDependencies, type: string, infographicId: string, payload: unknown) {
  return InfEventSchema.parse({ eventId: uuid(deps), schemaVersion: 1, type, occurredAt: now(deps).toISOString(), infographicId, payload });
}

export function ownerSession(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return owner(request, deps, async (_snapshot, mode) => jsonResponse({ authenticated: true, owner: deps.allowedGithubUser, mode }));
}

export function ownerList(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  return owner(request, deps, async (snapshot) => jsonResponse({ infographics: snapshot.infographics, categories: snapshot.catalog.categories, tags: snapshot.catalog.tags }));
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
    const service = new SyncService({ storage: deps.storage, events: deps.events as EventStore, publicRootId: deps.publicRootId, inboxFolderId: deps.inboxFolderId, thumbnailsFolderId: deps.thumbnailsFolderId, duplicatesFolderId: deps.duplicatesFolderId, now: () => now(deps), uuid: () => uuid(deps) });
    return jsonResponse(await service.syncInbox(input));
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

export function ownerCapture(request: RequestLike, deps: OwnerDependencies): Promise<HttpResponse> {
  // Parse the bounded request before EventStore/CaptureService work so rejected payloads have no storage/event side effects.
  return authorized(request, deps, async () => {
    const form = await parseMultipart(request); const file = form.get("file");
    if (!file || typeof file === "string" || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function" || !file.type) throw new AppError("INVALID_MULTIPART", 400, "Multipart image file is required");
    const metadataResult = CaptureMetadataSchema.safeParse({ title: optionalFormString(form, "title"), notes: optionalFormString(form, "notes"), sourceUrl: optionalFormString(form, "sourceUrl"), sourcePlatform: optionalFormString(form, "sourcePlatform"), sourceAuthor: optionalFormString(form, "sourceAuthor") });
    if (!metadataResult.success) throw new AppError("INVALID_MULTIPART", 400, "Multipart metadata is invalid");
    const metadata = metadataResult.data;
    const captured = await new CaptureService({ storage: deps.storage, events: deps.events as EventStore, publicRootId: deps.publicRootId, inboxFolderId: deps.inboxFolderId, thumbnailsFolderId: deps.thumbnailsFolderId, now: () => now(deps), uuid: () => uuid(deps) }).capture({ bytes: Buffer.from(await file.arrayBuffer()), declaredMime: file.type, name: file.name, ...metadata });
    return jsonResponse(captured, captured.kind === "created" ? 201 : 200);
  });
}

async function assignCategories(
  deps: OwnerDependencies,
  item: CatalogSnapshot["infographics"][number],
  categories: Category[],
): Promise<void> {
  const assignment = () => deps.events.append(event(deps, "infographic.categoriesAssigned", item.id, { categories }));
  if (categories.length === 0 || item.processedAt !== null) { await assignment(); return; }
  await deps.storage.moveFile(item.originalDriveFileId, deps.inboxFolderId, deps.libraryFolderId);
  try { await assignment(); } catch (primaryError) {
    try { await deps.storage.moveFile(item.originalDriveFileId, deps.libraryFolderId, deps.inboxFolderId); }
    catch (compensationError) {
      throw new AppError("INTEGRITY", 500, `Category assignment failed and Drive rollback failed: ${String(compensationError)}`);
    }
    throw primaryError;
  }
}
