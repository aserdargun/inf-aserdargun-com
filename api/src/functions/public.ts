import { toPublicInfographic } from "../http/public-projection.js";
import { AppError, binaryResponse, errorResponse, jsonResponse, type HttpResponse } from "../http/errors.js";
import { pathSegment, uuidPath, type RequestLike } from "../http/parse.js";
import { CatalogService } from "../services/catalog-service.js";
import type { EventStore } from "../storage/event-store.js";
import type { StoragePort } from "../storage/storage-port.js";

export interface PublicDependencies {
  storage: StoragePort;
  events: Pick<EventStore, "readAll">;
  publicRootId: string;
}

function contentTypeFor(fileId: string, snapshot: Awaited<ReturnType<CatalogService["snapshot"]>>): string {
  for (const item of snapshot.infographics) {
    if (item.originalDriveFileId === fileId) return item.detectedMimeType;
    if (item.thumbnailDriveFileId === fileId) return "image/webp";
  }
  return "application/octet-stream";
}

export async function publicList(request: RequestLike, deps: PublicDependencies): Promise<HttpResponse> {
  try {
    const snapshot = await new CatalogService(deps.events).snapshot();
    return jsonResponse(snapshot.infographics.map(toPublicInfographic), 200, "public");
  } catch (error) { return errorResponse(error, "public"); }
}

export async function publicGet(request: RequestLike, deps: PublicDependencies): Promise<HttpResponse> {
  try {
    const id = uuidPath(request, "/api/public/infographics/");
    const catalog = new CatalogService(deps.events); const snapshot = await catalog.snapshot();
    return jsonResponse(toPublicInfographic(catalog.item(snapshot, id)), 200, "public");
  } catch (error) { return errorResponse(error, "public"); }
}

export async function publicImage(request: RequestLike, deps: PublicDependencies): Promise<HttpResponse> {
  try {
    const fileId = pathSegment(request, "/api/public/images/");
    // Descendant verification precedes every read and every storage failure is a public 404.
    let allowed = false;
    try { allowed = await deps.storage.isDescendant(fileId, deps.publicRootId); } catch { allowed = false; }
    if (!allowed) throw new AppError("NOT_FOUND", 404, "Image was not found");
    const snapshot = await new CatalogService(deps.events).snapshot();
    let bytes: Buffer;
    try { bytes = await deps.storage.readFile(fileId); } catch { throw new AppError("NOT_FOUND", 404, "Image was not found"); }
    return binaryResponse(bytes, contentTypeFor(fileId, snapshot));
  } catch (error) { return errorResponse(error, "public"); }
}
