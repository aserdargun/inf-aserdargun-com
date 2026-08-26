import { z } from "zod";

// This entry point deliberately owns its primitives so anonymous bundles never
// traverse the owner entity or API schema graph.
const PublicUuidSchema = z.uuid();
const PublicTitleSchema = z.string().trim().min(1).max(200).refine(
  (value) => [...value].every((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint > 31 && codePoint !== 127;
  }),
  "Title must not contain control characters",
);
const PublicUtcDateTimeSchema = z.iso.datetime().regex(/Z$/, "Timestamp must use UTC Z notation");

export const PublicInfographicSchema = z.strictObject({
  id: PublicUuidSchema,
  title: PublicTitleSchema,
  publishedAt: PublicUtcDateTimeSchema,
  thumbnailUrl: z.string().startsWith("/api/public/images/"),
  imageUrl: z.string().startsWith("/api/public/images/"),
});
export type PublicInfographic = z.infer<typeof PublicInfographicSchema>;

// Default page size is tuned to the public gallery's three-column grid on
// desktop; the upper bound keeps the JSON response small even with thumbnails
// eagerly prefetched by the shell.
const PUBLIC_CATALOG_DEFAULT_PAGE_SIZE = 12;
const PUBLIC_CATALOG_MAX_PAGE_SIZE = 50;

export const PublicCatalogQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PUBLIC_CATALOG_MAX_PAGE_SIZE).default(PUBLIC_CATALOG_DEFAULT_PAGE_SIZE),
});
export type PublicCatalogQuery = z.infer<typeof PublicCatalogQuerySchema>;

export const PublicCatalogPageSchema = z.strictObject({
  items: z.array(PublicInfographicSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(PUBLIC_CATALOG_MAX_PAGE_SIZE),
  totalItems: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});
export type PublicCatalogPage = z.infer<typeof PublicCatalogPageSchema>;

export const PUBLIC_CATALOG_PAGE_SIZE = PUBLIC_CATALOG_DEFAULT_PAGE_SIZE;
