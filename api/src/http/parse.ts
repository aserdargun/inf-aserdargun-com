import { z } from "zod";
import { AppError } from "./errors.js";

export interface RequestLike {
  readonly url: string;
  readonly headers: Headers;
  readonly body?: ByteReadableStream | null;
  json(): Promise<unknown>;
  formData(): Promise<FormData>;
}

/** Deliberately structural so Azure's node:stream/web body and browser bodies both fit. */
export interface ByteReadableStream {
  getReader(): {
    read(): Promise<{ done: boolean; value?: unknown }>;
    cancel(reason?: unknown): Promise<void>;
    releaseLock(): void;
  };
}

/** Hard request ceiling; applies to multipart envelope, metadata, and file bytes. */
export const MAX_MULTIPART_BYTES = 20 * 1024 * 1024;

export function pathSegment(request: Pick<RequestLike, "url">, prefix: string): string {
  let pathname: string;
  try { pathname = new URL(request.url).pathname; } catch { throw new AppError("INVALID_PATH", 400, "Request URL is invalid"); }
  if (!pathname.startsWith(prefix)) throw new AppError("INVALID_PATH", 400, "Request path is invalid");
  const value = pathname.slice(prefix.length);
  if (!value || value.includes("/")) throw new AppError("INVALID_PATH", 400, "Request path is invalid");
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) throw new Error();
    return decoded;
  } catch { throw new AppError("INVALID_PATH", 400, "Request path is invalid"); }
}

export function uuidPath(request: Pick<RequestLike, "url">, prefix: string): string {
  const id = pathSegment(request, prefix);
  if (!z.uuid().safeParse(id).success) throw new AppError("INVALID_ID", 400, "Infographic ID is invalid");
  return id;
}

export async function parseJson<T>(request: RequestLike, schema: z.ZodType<T>): Promise<T> {
  if (!request.headers.get("content-type")?.toLocaleLowerCase("en-US").startsWith("application/json")) throw new AppError("INVALID_BODY", 400, "Expected an application/json request body");
  let value: unknown;
  try { value = await request.json(); } catch { throw new AppError("INVALID_BODY", 400, "Request JSON is malformed"); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError("INVALID_BODY", 400, "Request body is invalid");
  return parsed.data;
}

export function optionalFormString(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  if (value === null) return undefined;
  if (typeof value !== "string") throw new AppError("INVALID_MULTIPART", 400, `Multipart field ${name} is invalid`);
  return value === "" ? undefined : value;
}

export async function parseMultipart(request: RequestLike): Promise<FormData> {
  if (!request.headers.get("content-type")?.toLocaleLowerCase("en-US").startsWith("multipart/form-data")) throw new AppError("INVALID_MULTIPART", 400, "Expected a multipart/form-data request body");
  const contentType = request.headers.get("content-type")!;
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength) && BigInt(declaredLength) > BigInt(MAX_MULTIPART_BYTES)) {
    throw new AppError("MULTIPART_TOO_LARGE", 413, "Multipart request exceeds the 20 MiB limit");
  }
  if (!request.body) throw new AppError("INVALID_MULTIPART", 400, "Multipart request body is missing");
  let bytes: Buffer;
  try { bytes = await readBoundedMultipartBody(request.body); } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INVALID_MULTIPART", 400, "Multipart body is malformed");
  }
  let form: FormData;
  const formBody = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  try { form = await new Response(formBody, { headers: { "content-type": contentType } }).formData(); } catch { throw new AppError("INVALID_MULTIPART", 400, "Multipart body is malformed"); }
  let parsedBytes = 0;
  for (const [, value] of form.entries()) {
    parsedBytes += typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.size;
    if (parsedBytes > MAX_MULTIPART_BYTES) throw new AppError("MULTIPART_TOO_LARGE", 413, "Multipart request exceeds the 20 MiB limit");
  }
  return form;
}

async function readBoundedMultipartBody(stream: ByteReadableStream): Promise<Buffer> {
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const bytes = next.value;
      if (!(bytes instanceof Uint8Array)) throw new AppError("INVALID_MULTIPART", 400, "Multipart body is malformed");
      total += bytes.byteLength;
      if (total > MAX_MULTIPART_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new AppError("MULTIPART_TOO_LARGE", 413, "Multipart request exceeds the 20 MiB limit");
      }
      chunks.push(bytes);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}
