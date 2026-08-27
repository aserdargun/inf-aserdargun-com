import { z } from "zod";
import {
  CategorySchema,
  MaterializedInfographicSchema,
  PublicSafeTitleSchema,
  RejectedFileSchema,
  ReviewRatingSchema,
  ReviewRecordSchema,
  TagSchema,
  UtcDateTimeSchema,
  UuidSchema,
} from "./entities";
export { PublicCatalogPageSchema, PublicCatalogQuerySchema, PublicInfographicSchema, PUBLIC_CATALOG_PAGE_SIZE } from "./public";
export type { PublicCatalogPage, PublicCatalogQuery, PublicInfographic } from "./public";

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
  /**
   * JSON-encoded array of {@link Category} objects. The capture service
   * appends an `infographic.categoriesAssigned` event so the new item lands
   * in the Library with its category in the same transaction as the create
   * event — no follow-up PATCH is required.
   */
  categories: z.array(CategorySchema).optional(),
  /**
   * JSON-encoded array of {@link Tag} objects. Mirrors {@link categories}
   * for tags so the capture write is a single round trip.
   */
  tags: z.array(TagSchema).optional(),
});

export const InfographicPatchSchema = z.strictObject({
  title: PublicSafeTitleSchema.optional(),
  notes: z.string().max(10_000).nullable().optional(),
  favorite: z.boolean().optional(),
  archived: z.boolean().optional(),
  categories: z.array(CategorySchema).optional(),
  tags: z.array(TagSchema).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one patch field is required");

export const ConfirmDeleteSchema = z.strictObject({ confirm: z.literal(true) });
export const ReviewRequestSchema = z.strictObject({ rating: ReviewRatingSchema });

export const AiMetadataSuggestionSchema = z.strictObject({
  title: PublicSafeTitleSchema.nullable(),
  notes: z.string().max(10_000).nullable(),
  language: z.string().trim().min(2).max(8).nullable(),
  /**
   * A single primary category label that best classifies the infographic. The
   * model is told the existing category names so it can reuse them instead of
   * inventing near-duplicates (e.g. "GPU" vs "GPUs"). Null when the model is
   * not confident enough to pick one.
   */
  category: z.string().trim().min(1).max(80).nullable(),
  topics: z.array(z.string().trim().min(1).max(80)).max(10),
  rationale: z.string().trim().min(1).max(500).nullable(),
  confidence: z.number().min(0).max(1),
});
export type AiMetadataSuggestion = z.infer<typeof AiMetadataSuggestionSchema>;

export const AiSuggestionResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  model: z.string().min(1),
  generatedAt: UtcDateTimeSchema,
  suggestion: AiMetadataSuggestionSchema,
});
export type AiSuggestionResponse = z.infer<typeof AiSuggestionResponseSchema>;

/**
 * Per-infographic AI suggestion: the owner-only POST /api/infographics/{id}/suggest
 * endpoint returns the suggestion payload directly. Capture uses the richer
 * {@link AiSuggestionResponseSchema} envelope and is intentionally untouched.
 */
export const AiSuggestionSchema = z.strictObject({
  suggestion: AiMetadataSuggestionSchema,
});
export type AiSuggestion = z.infer<typeof AiSuggestionSchema>;

export const SessionResponseSchema = z.strictObject({
  authenticated: z.literal(true),
  owner: z.string().min(1),
  mode: z.enum(["github", "local-bypass"]),
});

export const OwnerCatalogResponseSchema = z.strictObject({
  infographics: z.array(MaterializedInfographicSchema),
  categories: z.array(CategorySchema),
  tags: z.array(TagSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(200),
  totalItems: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

const CatalogQuerySlugSchema = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
// Library-side pagination defaults: 24 fits the 4-column desktop grid (6 rows
// per page) and stays light on the JSON response. Inbox raises pageSize at the
// call site to keep the uncategorized backlog in a single round trip.
const OWNER_CATALOG_DEFAULT_PAGE_SIZE = 24;
const OWNER_CATALOG_MAX_PAGE_SIZE = 200;
export const OwnerCatalogQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(200).optional(),
  category: CatalogQuerySlugSchema.optional(),
  tag: CatalogQuerySlugSchema.optional(),
  favorite: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  sort: z.enum(["recent", "least-seen"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(OWNER_CATALOG_MAX_PAGE_SIZE).default(OWNER_CATALOG_DEFAULT_PAGE_SIZE),
});

export const ReviewResponseSchema = ReviewRecordSchema;
export const DueReviewResponseSchema = z.strictObject({ infographics: z.array(MaterializedInfographicSchema) });
export const SurpriseResponseSchema = z.strictObject({ infographic: MaterializedInfographicSchema.nullable() });
export const SettingsStatsResponseSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  uncategorized: z.number().int().nonnegative(),
  library: z.number().int().nonnegative(),
  archive: z.number().int().nonnegative(),
  due: z.number().int().nonnegative(),
  reviewed: z.number().int().nonnegative(),
  seen: z.number().int().nonnegative(),
});

export const FolderHealthSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  healthy: z.boolean(),
});

export const DriveHealthSchema = z.strictObject({
  rootId: z.string().min(1),
  folderUrl: z.url(),
  healthy: z.boolean(),
  folders: z.array(FolderHealthSchema),
});

export const SettingsInventoryItemSchema = z.strictObject({
  id: UuidSchema,
  title: PublicSafeTitleSchema,
  originalDriveFileId: z.string().min(1),
  thumbnailDriveFileId: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  detectedMimeType: z.string().startsWith("image/"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  folderState: z.enum(["Inbox", "Library", "Archive"]),
  createdAt: UtcDateTimeSchema,
  capturedAt: UtcDateTimeSchema,
  processedAt: UtcDateTimeSchema.nullable(),
  lastSeenAt: UtcDateTimeSchema.nullable(),
});

export const SettingsHealthResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  application: z.strictObject({ name: z.literal("Infographics"), version: z.string().min(1), runtimeVersion: z.string().min(1), usesAi: z.boolean() }),
  connectionHealth: z.strictObject({ publicDrive: DriveHealthSchema, privateDrive: DriveHealthSchema }),
  data: SettingsStatsResponseSchema,
  quarantine: z.strictObject({
    count: z.number().int().nonnegative(),
    reasons: z.array(z.strictObject({ reason: z.string().min(1), count: z.number().int().positive() })),
    rejectedFiles: z.array(RejectedFileSchema),
  }),
  recovery: z.strictObject({ inventorySchemaVersion: z.literal(1), items: z.array(SettingsInventoryItemSchema) }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
export type SyncRequest = z.infer<typeof SyncRequestSchema>;
export type CaptureMetadata = z.infer<typeof CaptureMetadataSchema>;
export type InfographicPatch = z.infer<typeof InfographicPatchSchema>;
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
export type OwnerCatalogResponse = z.infer<typeof OwnerCatalogResponseSchema>;
export type OwnerCatalogQuery = z.infer<typeof OwnerCatalogQuerySchema>;
export type DueReviewResponse = z.infer<typeof DueReviewResponseSchema>;
export type SurpriseResponse = z.infer<typeof SurpriseResponseSchema>;
export type SettingsStatsResponse = z.infer<typeof SettingsStatsResponseSchema>;
export type SettingsHealthResponse = z.infer<typeof SettingsHealthResponseSchema>;
export type SettingsInventoryItem = z.infer<typeof SettingsInventoryItemSchema>;
