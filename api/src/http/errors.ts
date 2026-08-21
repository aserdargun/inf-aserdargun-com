import type { ApiError } from "@inf/contracts";

export class AppError extends Error {
  constructor(readonly code: string, readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 500, message: string) {
    super(message);
    this.name = "AppError";
  }
}

export interface HttpResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

type CacheKind = "private" | "public" | "image";

function headers(kind: CacheKind, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-security-policy": "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "cache-control": kind === "private" ? "no-store" : kind === "image" ? "public, max-age=31536000, immutable" : "public, max-age=60",
    ...extra,
  };
}

export function jsonResponse(value: unknown, status = 200, kind: CacheKind = "private"): HttpResponse {
  return { status, headers: headers(kind, { "content-type": "application/json; charset=utf-8" }), body: JSON.stringify(value) };
}

export function emptyResponse(status = 204): HttpResponse { return { status, headers: headers("private") }; }

export function binaryResponse(bytes: Buffer, contentType: string): HttpResponse {
  return { status: 200, headers: headers("image", { "content-type": contentType }), body: bytes };
}

export function errorResponse(error: unknown, kind: CacheKind = "private"): HttpResponse {
  const appError = error instanceof AppError ? error : new AppError("INTERNAL", 500, "Internal server error");
  const body: ApiError = { code: appError.code, message: appError.status === 500 ? "Internal server error" : appError.message };
  return jsonResponse(body, appError.status, kind);
}
