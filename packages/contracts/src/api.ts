import { z } from "zod";
import {
  PublicSafeTitleSchema,
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

export type PublicInfographic = z.infer<typeof PublicInfographicSchema>;
export type PublicCatalogResponse = z.infer<typeof PublicCatalogResponseSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
