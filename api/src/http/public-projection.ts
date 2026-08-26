import { PublicCatalogQuerySchema, type MaterializedInfographic, type PublicInfographic } from "@inf/contracts";

// Re-exported from this module so the public HTTP handlers can validate and
// parse the public catalog query string in one place.
export { PublicCatalogQuerySchema };

const publicImagePath = (driveFileId: string) => `/api/public/images/${encodeURIComponent(driveFileId)}`;

/** Constructs the public five-field DTO; private owner fields are never spread into it. */
export function toPublicInfographic(item: MaterializedInfographic): PublicInfographic {
  return {
    id: item.id,
    title: item.title,
    publishedAt: item.capturedAt,
    thumbnailUrl: publicImagePath(item.thumbnailDriveFileId),
    imageUrl: publicImagePath(item.originalDriveFileId),
  };
}
