import { readFileSync } from "node:fs";
import * as contracts from "@inf/contracts";
import { expect, test } from "vitest";

test("contracts barrel exports each module once and keeps the exact runtime surface", () => {
  const source = readFileSync("packages/contracts/src/index.ts", "utf8");
  expect(source.match(/export \* from "\.\/api";/g)).toHaveLength(1);
  expect(Object.keys(contracts).sort()).toEqual([
    "AiCropSuggestionSchema", "AiMetadataSuggestionSchema", "AiSuggestionResponseSchema", "AiSuggestionSchema", "ApiErrorSchema", "CaptureMetadataSchema", "CategorySchema", "ConfirmDeleteSchema", "DriveFolderStateSchema", "DriveHealthSchema",
    "DueReviewResponseSchema", "EVENT_SCHEMA_VERSION", "EmptyEventPayloadSchema", "FolderHealthSchema", "ImageMimeTypeSchema", "InfEventSchema",
    "InfographicArchivedEventSchema", "InfographicCategoriesAssignedEventSchema", "InfographicCategoriesAssignedPayloadSchema", "InfographicCreatedEventSchema",
    "InfographicCreatedPayloadSchema", "InfographicDeletedEventSchema", "InfographicFavoriteChangedEventSchema", "InfographicFavoriteChangedPayloadSchema",
    "InfographicImageReplacedEventSchema", "InfographicImageReplacedPayloadSchema", "InfographicMetadataUpdatedEventSchema", "InfographicMetadataUpdatedPayloadSchema",
    "InfographicPatchSchema", "InfographicPromotedToLibraryEventSchema", "InfographicSeenEventSchema", "InfographicTagsAssignedEventSchema", "InfographicTagsAssignedPayloadSchema",
    "MaterializedCatalogSchema", "MaterializedInfographicSchema", "MimeTypeSchema", "OwnerCatalogQuerySchema", "OwnerCatalogResponseSchema",
    "PUBLIC_CATALOG_PAGE_SIZE", "PublicCatalogPageSchema", "PublicCatalogQuerySchema", "PublicInfographicSchema",
    "PublicSafeTitleSchema", "RejectedFileSchema", "ReviewRatingSchema", "ReviewRecordSchema", "ReviewRecordedEventSchema", "ReviewRecordedPayloadSchema", "ReviewRequestSchema",
    "ReviewResponseSchema", "SessionResponseSchema", "SettingsHealthResponseSchema", "SettingsInventoryItemSchema", "SettingsStatsResponseSchema",
    "Sha256Schema", "SurpriseResponseSchema", "SyncFileRejectedEventSchema", "SyncFileRejectedPayloadSchema", "SyncRequestSchema", "TagSchema",
    "UtcDateTimeSchema", "UuidSchema",
  ]);
});
