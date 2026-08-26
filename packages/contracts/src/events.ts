import { z } from "zod";
import {
  CategorySchema,
  DriveFolderStateSchema,
  ImageMimeTypeSchema,
  MimeTypeSchema,
  PublicSafeTitleSchema,
  ReviewRatingSchema,
  Sha256Schema,
  TagSchema,
  UtcDateTimeSchema,
  UuidSchema,
} from "./entities";

export const EVENT_SCHEMA_VERSION = 1 as const;

const PrivateMetadataFields = {
  notes: z.string().max(10_000).nullable().optional(),
};

export const InfographicCreatedPayloadSchema = z.strictObject({
  originalDriveFileId: z.string().min(1),
  thumbnailDriveFileId: z.string().min(1),
  sha256: Sha256Schema,
  detectedMimeType: ImageMimeTypeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  title: PublicSafeTitleSchema,
  ...PrivateMetadataFields,
  capturedAt: UtcDateTimeSchema,
  createdAt: UtcDateTimeSchema,
  folderState: DriveFolderStateSchema,
});

export const InfographicMetadataUpdatedPayloadSchema = z.strictObject({
  title: PublicSafeTitleSchema.optional(),
  ...PrivateMetadataFields,
}).refine((payload) => Object.keys(payload).length > 0, "At least one metadata field is required");

export const InfographicCategoriesAssignedPayloadSchema = z.strictObject({
  categories: z.array(CategorySchema),
});

export const InfographicTagsAssignedPayloadSchema = z.strictObject({
  tags: z.array(TagSchema),
});

export const InfographicFavoriteChangedPayloadSchema = z.strictObject({
  favorite: z.boolean(),
});

export const EmptyEventPayloadSchema = z.strictObject({});

export const ReviewRecordedPayloadSchema = z.strictObject({
  reviewId: UuidSchema,
  rating: ReviewRatingSchema,
  reviewedAt: UtcDateTimeSchema,
  previousIntervalDays: z.number().int().positive().nullable(),
  intervalDays: z.number().int().positive(),
  dueAt: UtcDateTimeSchema,
});

export const SyncFileRejectedPayloadSchema = z.strictObject({
  driveFileId: z.string().min(1),
  fileName: z.string().min(1),
  reason: z.string().trim().min(1).max(500),
  detectedMimeType: MimeTypeSchema.optional(),
});

const envelope = {
  eventId: UuidSchema,
  schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
  occurredAt: UtcDateTimeSchema,
};

function infographicEvent<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.strictObject({
    ...envelope,
    type: z.literal(type),
    infographicId: UuidSchema,
    payload,
  });
}

export const InfographicCreatedEventSchema = infographicEvent(
  "infographic.created",
  InfographicCreatedPayloadSchema,
);
export const InfographicMetadataUpdatedEventSchema = infographicEvent(
  "infographic.metadataUpdated",
  InfographicMetadataUpdatedPayloadSchema,
);
export const InfographicCategoriesAssignedEventSchema = infographicEvent(
  "infographic.categoriesAssigned",
  InfographicCategoriesAssignedPayloadSchema,
);
export const InfographicTagsAssignedEventSchema = infographicEvent(
  "infographic.tagsAssigned",
  InfographicTagsAssignedPayloadSchema,
);
export const InfographicFavoriteChangedEventSchema = infographicEvent(
  "infographic.favoriteChanged",
  InfographicFavoriteChangedPayloadSchema,
);
export const InfographicArchivedEventSchema = infographicEvent(
  "infographic.archived",
  EmptyEventPayloadSchema,
);
export const InfographicPromotedToLibraryEventSchema = infographicEvent(
  "infographic.promotedToLibrary",
  EmptyEventPayloadSchema,
);
export const InfographicDeletedEventSchema = infographicEvent(
  "infographic.deleted",
  EmptyEventPayloadSchema,
);
export const InfographicImageReplacedPayloadSchema = z.strictObject({
  previousOriginalDriveFileId: z.string().min(1),
  previousThumbnailDriveFileId: z.string().min(1),
  originalDriveFileId: z.string().min(1),
  thumbnailDriveFileId: z.string().min(1),
  sha256: Sha256Schema,
  detectedMimeType: ImageMimeTypeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export const InfographicImageReplacedEventSchema = infographicEvent(
  "infographic.imageReplaced",
  InfographicImageReplacedPayloadSchema,
);
export const InfographicSeenEventSchema = infographicEvent(
  "infographic.seen",
  EmptyEventPayloadSchema,
);
export const ReviewRecordedEventSchema = infographicEvent(
  "review.recorded",
  ReviewRecordedPayloadSchema,
);

export const SyncFileRejectedEventSchema = z.strictObject({
  ...envelope,
  type: z.literal("sync.fileRejected"),
  payload: SyncFileRejectedPayloadSchema,
});

export const InfEventSchema = z.discriminatedUnion("type", [
  InfographicCreatedEventSchema,
  InfographicMetadataUpdatedEventSchema,
  InfographicCategoriesAssignedEventSchema,
  InfographicTagsAssignedEventSchema,
  InfographicFavoriteChangedEventSchema,
  InfographicArchivedEventSchema,
  InfographicPromotedToLibraryEventSchema,
  InfographicDeletedEventSchema,
  InfographicImageReplacedEventSchema,
  InfographicSeenEventSchema,
  ReviewRecordedEventSchema,
  SyncFileRejectedEventSchema,
]);

export type InfographicCreatedPayload = z.infer<typeof InfographicCreatedPayloadSchema>;
export type InfographicMetadataUpdatedPayload = z.infer<typeof InfographicMetadataUpdatedPayloadSchema>;
export type InfographicCategoriesAssignedPayload = z.infer<typeof InfographicCategoriesAssignedPayloadSchema>;
export type InfographicTagsAssignedPayload = z.infer<typeof InfographicTagsAssignedPayloadSchema>;
export type InfographicFavoriteChangedPayload = z.infer<typeof InfographicFavoriteChangedPayloadSchema>;
export type ReviewRecordedPayload = z.infer<typeof ReviewRecordedPayloadSchema>;
export type SyncFileRejectedPayload = z.infer<typeof SyncFileRejectedPayloadSchema>;
export type InfographicCreatedEvent = z.infer<typeof InfographicCreatedEventSchema>;
export type InfographicMetadataUpdatedEvent = z.infer<typeof InfographicMetadataUpdatedEventSchema>;
export type InfographicCategoriesAssignedEvent = z.infer<typeof InfographicCategoriesAssignedEventSchema>;
export type InfographicTagsAssignedEvent = z.infer<typeof InfographicTagsAssignedEventSchema>;
export type InfographicFavoriteChangedEvent = z.infer<typeof InfographicFavoriteChangedEventSchema>;
export type InfographicArchivedEvent = z.infer<typeof InfographicArchivedEventSchema>;
export type InfographicPromotedToLibraryEvent = z.infer<typeof InfographicPromotedToLibraryEventSchema>;
export type InfographicDeletedEvent = z.infer<typeof InfographicDeletedEventSchema>;
export type InfographicImageReplacedPayload = z.infer<typeof InfographicImageReplacedPayloadSchema>;
export type InfographicImageReplacedEvent = z.infer<typeof InfographicImageReplacedEventSchema>;
export type InfographicSeenEvent = z.infer<typeof InfographicSeenEventSchema>;
export type ReviewRecordedEvent = z.infer<typeof ReviewRecordedEventSchema>;
export type SyncFileRejectedEvent = z.infer<typeof SyncFileRejectedEventSchema>;
export type InfEvent = z.infer<typeof InfEventSchema>;
export type InfEventType = InfEvent["type"];
