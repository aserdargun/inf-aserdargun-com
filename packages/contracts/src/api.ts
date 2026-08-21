import { z } from "zod";
import {
  CategorySchema,
  MaterializedInfographicSchema,
  PublicSafeTitleSchema,
  ReviewRatingSchema,
  ReviewRecordSchema,
  TagSchema,
  UtcDateTimeSchema,
  UuidSchema,
} from "./entities";

export const PublicInfographicSchema = z.strictObject({
  id: UuidSchema,
  title: PublicSafeTitleSchema,
  publishedAt: UtcDateTimeSchema,
  thumbnailUrl: z.string().startsWith("/api/public/images/"),
  imageUrl: z.string().startsWith("/api/public/images/"),
});

export const PublicCatalogResponseSchema = z.array(PublicInfographicSchema);

export const ApiErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const SyncRequestSchema = z.strictObject({
  limit: z.number().int().min(1).max(50).optional(),
});

export const CaptureMetadataSchema = z.strictObject({
  title: PublicSafeTitleSchema.optional(),
  notes: z.string().max(10_000).nullable().optional(),
  sourceUrl: z.url().nullable().optional(),
  sourcePlatform: z.string().trim().min(1).max(100).nullable().optional(),
  sourceAuthor: z.string().trim().min(1).max(200).nullable().optional(),
});

export const InfographicPatchSchema = z.strictObject({
  title: PublicSafeTitleSchema.optional(),
  notes: z.string().max(10_000).nullable().optional(),
  sourceUrl: z.url().nullable().optional(),
  sourcePlatform: z.string().trim().min(1).max(100).nullable().optional(),
  sourceAuthor: z.string().trim().min(1).max(200).nullable().optional(),
  favorite: z.boolean().optional(),
  archived: z.boolean().optional(),
  categories: z.array(CategorySchema).optional(),
  tags: z.array(TagSchema).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one patch field is required");

export const ConfirmDeleteSchema = z.strictObject({ confirm: z.literal(true) });
export const ReviewRequestSchema = z.strictObject({ rating: ReviewRatingSchema });

export const SessionResponseSchema = z.strictObject({
  authenticated: z.literal(true),
  owner: z.string().min(1),
  mode: z.enum(["github", "local-bypass"]),
});

export const OwnerCatalogResponseSchema = z.strictObject({
  infographics: z.array(MaterializedInfographicSchema),
  categories: z.array(CategorySchema),
  tags: z.array(TagSchema),
});

export const ReviewResponseSchema = ReviewRecordSchema;
export const DueReviewResponseSchema = z.strictObject({ infographics: z.array(MaterializedInfographicSchema) });
export const SurpriseResponseSchema = z.strictObject({ infographic: MaterializedInfographicSchema.nullable() });
export const SettingsStatsResponseSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  inbox: z.number().int().nonnegative(),
  library: z.number().int().nonnegative(),
  archive: z.number().int().nonnegative(),
  due: z.number().int().nonnegative(),
  reviewed: z.number().int().nonnegative(),
  seen: z.number().int().nonnegative(),
});

export type PublicInfographic = z.infer<typeof PublicInfographicSchema>;
export type PublicCatalogResponse = z.infer<typeof PublicCatalogResponseSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type SyncRequest = z.infer<typeof SyncRequestSchema>;
export type CaptureMetadata = z.infer<typeof CaptureMetadataSchema>;
export type InfographicPatch = z.infer<typeof InfographicPatchSchema>;
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
