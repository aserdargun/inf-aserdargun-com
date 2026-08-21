import { z } from "zod";
import {
  DriveFolderStateSchema,
  ImageMimeTypeSchema,
  PublicSafeTitleSchema,
  UtcDateTimeSchema,
  UuidSchema,
} from "./entities";

export const PublicInfographicSchema = z.strictObject({
  id: UuidSchema,
  title: PublicSafeTitleSchema,
  thumbnailDriveFileId: z.string().min(1),
  detectedMimeType: ImageMimeTypeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  capturedAt: UtcDateTimeSchema,
  categoryIds: z.array(UuidSchema),
  tagIds: z.array(UuidSchema),
  archived: z.boolean(),
  folderState: DriveFolderStateSchema,
});

export const PublicCatalogResponseSchema = z.array(PublicInfographicSchema);

export const ApiErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
});

export type PublicInfographic = z.infer<typeof PublicInfographicSchema>;
export type PublicCatalogResponse = z.infer<typeof PublicCatalogResponseSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
