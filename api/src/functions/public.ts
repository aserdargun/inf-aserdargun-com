import { toPublicInfographic } from "../http/public-projection.js";
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

export async function publicList(request: RequestLike, deps: PublicDependencies): Promise<HttpResponse> {
  try {
    const snapshot = await new CatalogService(deps.events).snapshot();
    const live = await Promise.all(snapshot.infographics.map(async (item) => (await isLivePublicItem(item, deps)) ? item : null));
    return jsonResponse(live.filter((item): item is MaterializedInfographic => item !== null).map(toPublicInfographic), 200, "public");
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
