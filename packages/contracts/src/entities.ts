import { z } from "zod";

export const UuidSchema = z.uuid();
export const UtcDateTimeSchema = z.iso.datetime().regex(/Z$/, "Timestamp must use UTC Z notation");
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 digest");
export const MimeTypeSchema = z.string().regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/);
export const ImageMimeTypeSchema = MimeTypeSchema.refine((value) => value.startsWith("image/"));
export const DriveFolderStateSchema = z.enum(["Inbox", "Library", "Archive"]);
export const ReviewRatingSchema = z.enum(["again", "hard", "good", "easy"]);

export const PublicSafeTitleSchema = z.string().trim().min(1).max(200).refine(
  (value) => [...value].every((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint > 31 && codePoint !== 127;
  }),
  "Title must not contain control characters",
);

const NamedTaxonomyFields = {
  id: UuidSchema,
  displayName: z.string().trim().min(1).max(80),
  normalizedName: z.string().trim().min(1).max(80).refine(
    (value) => value === value.toLocaleLowerCase("en-US"),
    "Normalized name must be lowercase",
  ),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
};

export const CategorySchema = z.strictObject(NamedTaxonomyFields);
export const TagSchema = z.strictObject(NamedTaxonomyFields);

export const ReviewRecordSchema = z.strictObject({
  id: UuidSchema,
  infographicId: UuidSchema,
  rating: ReviewRatingSchema,
  reviewedAt: UtcDateTimeSchema,
  previousIntervalDays: z.number().int().positive().nullable(),
  intervalDays: z.number().int().positive(),
  dueAt: UtcDateTimeSchema,
});

export const RejectedFileSchema = z.strictObject({
  eventId: UuidSchema,
  occurredAt: UtcDateTimeSchema,
  driveFileId: z.string().min(1),
  fileName: z.string().min(1),
  reason: z.string().trim().min(1).max(500),
  detectedMimeType: MimeTypeSchema.optional(),
});

export const MaterializedInfographicSchema = z.strictObject({
  id: UuidSchema,
  title: PublicSafeTitleSchema,
  notes: z.string().max(10_000).nullable(),
  originalDriveFileId: z.string().min(1),
  thumbnailDriveFileId: z.string().min(1),
  sha256: Sha256Schema,
  detectedMimeType: ImageMimeTypeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  favorite: z.boolean(),
  archived: z.boolean(),
  createdAt: UtcDateTimeSchema,
  capturedAt: UtcDateTimeSchema,
  processedAt: UtcDateTimeSchema.nullable(),
  lastSeenAt: UtcDateTimeSchema.nullable(),
  seenCount: z.number().int().nonnegative(),
  categoryIds: z.array(UuidSchema),
  tagIds: z.array(UuidSchema),
  folderState: DriveFolderStateSchema,
  reviewCount: z.number().int().nonnegative(),
  lastReviewedAt: UtcDateTimeSchema.nullable(),
  reviewDueAt: UtcDateTimeSchema.nullable(),
});

export const MaterializedCatalogSchema = z.strictObject({
  infographics: z.array(MaterializedInfographicSchema),
  categories: z.array(CategorySchema),
  tags: z.array(TagSchema),
  reviews: z.array(ReviewRecordSchema),
  deletedInfographicIds: z.array(UuidSchema),
  rejectedFiles: z.array(RejectedFileSchema),
});

export type Category = z.infer<typeof CategorySchema>;
export type Tag = z.infer<typeof TagSchema>;
export type DriveFolderState = z.infer<typeof DriveFolderStateSchema>;
export type ReviewRating = z.infer<typeof ReviewRatingSchema>;
export type ReviewRecord = z.infer<typeof ReviewRecordSchema>;
export type RejectedFile = z.infer<typeof RejectedFileSchema>;
export type MaterializedInfographic = z.infer<typeof MaterializedInfographicSchema>;
export type MaterializedCatalog = z.infer<typeof MaterializedCatalogSchema>;
