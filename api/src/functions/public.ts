import { PublicCatalogQuerySchema, toPublicInfographic } from "../http/public-projection.js";
import { AppError, binaryResponse, errorResponse, jsonResponse, type HttpResponse } from "../http/errors.js";
import { pathSegment, uuidPath, type RequestLike } from "../http/parse.js";
import { CatalogService } from "../services/catalog-service.js";
import type { EventStore } from "../storage/event-store.js";
import type { StoragePort } from "../storage/storage-port.js";
import type { MaterializedInfographic } from "@inf/contracts";

export interface PublicDependencies {
  storage: StoragePort;
  events: Pick<EventStore, "readAll">;
  publicRootId: string;
}

async function isLiveDescendant(storage: StoragePort, fileId: string, publicRootId: string): Promise<boolean> {
  try { return await storage.isDescendant(fileId, publicRootId); } catch { return false; }
}

/** A public DTO is only advertisable when both of its Drive assets are live. */
async function isLivePublicItem(item: MaterializedInfographic, deps: PublicDependencies): Promise<boolean> {
  const [original, thumbnail] = await Promise.all([
    isLiveDescendant(deps.storage, item.originalDriveFileId, deps.publicRootId),
    isLiveDescendant(deps.storage, item.thumbnailDriveFileId, deps.publicRootId),
  ]);
  return original && thumbnail;
}

function matchedRole(item: MaterializedInfographic, fileId: string): "original" | "thumbnail" | null {
  if (item.originalDriveFileId === fileId) return "original";
  if (item.thumbnailDriveFileId === fileId) return "thumbnail";
  return null;
}

function publicCatalogQuery(request: RequestLike): { page: number; pageSize: number } {
  let params: URLSearchParams;
  try { params = new URL(request.url).searchParams; } catch (cause) { console.error("URL parse failed", cause); throw new AppError("INVALID_QUERY", 400, "Catalog query is invalid"); }
  const raw: Record<string, string> = {};
  for (const [key, value] of params) {
    // Reject duplicate keys so callers cannot smuggle an out-of-bounds pageSize
    // by repeating a smaller value; duplicates land on the same key.
    if (key in raw) throw new AppError("INVALID_QUERY", 400, "Catalog query is invalid");
    raw[key] = value;
  }
  console.log("Parsing query", raw);
  const parsed = PublicCatalogQuerySchema.safeParse(raw);
  if (!parsed.success) { console.error("Parse failed", parsed.error); throw new AppError("INVALID_QUERY", 400, "Catalog query is invalid"); }
  return parsed.data;
}

/** The public gallery is ordered newest-publication-first with id as a stable tiebreaker so paging never reorders across requests. */
function sortForPublic(items: MaterializedInfographic[]): MaterializedInfographic[] {
  return [...items].sort((left, right) => right.capturedAt.localeCompare(left.capturedAt) || left.id.localeCompare(right.id));
}

export async function publicList(request: RequestLike, deps: PublicDependencies): Promise<HttpResponse> {
  try {
    const query = publicCatalogQuery(request);
    const snapshot = await new CatalogService(deps.events).snapshot();
    const live = await Promise.all(snapshot.infographics.map(async (item) => (await isLivePublicItem(item, deps)) ? item : null));
    const ordered = sortForPublic(live.filter((item): item is MaterializedInfographic => item !== null));
    const totalItems = ordered.length;
    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize);
    const start = (query.page - 1) * query.pageSize;
    const items = ordered.slice(start, start + query.pageSize).map(toPublicInfographic);
    return jsonResponse({ items, page: query.page, pageSize: query.pageSize, totalItems, totalPages }, 200, "public");
  } catch (error) { return errorResponse(error, "public"); }
}

export async function publicGet(request: RequestLike, deps: PublicDependencies): Promise<HttpResponse> {
  try {
    const id = uuidPath(request, "/api/public/infographics/");
    const catalog = new CatalogService(deps.events); const snapshot = await catalog.snapshot();
    const item = catalog.item(snapshot, id);
    if (!await isLivePublicItem(item, deps)) throw new AppError("NOT_FOUND", 404, "Infographic was not found");
    return jsonResponse(toPublicInfographic(item), 200, "public");
  } catch (error) { return errorResponse(error, "public"); }
}

export async function publicImage(request: RequestLike, deps: PublicDependencies): Promise<HttpResponse> {
  try {
    const fileId = pathSegment(request, "/api/public/images/");
    const snapshot = await new CatalogService(deps.events).snapshot();
    const item = snapshot.infographics.find((candidate) => matchedRole(candidate, fileId) !== null);
    if (!item) throw new AppError("NOT_FOUND", 404, "Image was not found");
    const role = matchedRole(item, fileId)!;
    // A client-controlled ID must both belong to an extant catalog item and prove live root descent before read.
    if (!await isLiveDescendant(deps.storage, fileId, deps.publicRootId)) throw new AppError("NOT_FOUND", 404, "Image was not found");
    let bytes: Buffer;
    try { bytes = await deps.storage.readFile(fileId); } catch { throw new AppError("NOT_FOUND", 404, "Image was not found"); }
    return binaryResponse(bytes, role === "original" ? item.detectedMimeType : "image/webp");
  } catch (error) { return errorResponse(error, "public"); }
}
