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
export const PublicCatalogResponseSchema = z.array(PublicInfographicSchema);
export type PublicInfographic = z.infer<typeof PublicInfographicSchema>;
export type PublicCatalogResponse = z.infer<typeof PublicCatalogResponseSchema>;
