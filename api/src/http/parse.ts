import { z } from "zod";
import { AppError } from "./errors.js";

export interface RequestLike {
  readonly url: string;
  readonly headers: Headers;
  json(): Promise<unknown>;
  formData(): Promise<FormData>;
}

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
  try { return await request.formData(); } catch { throw new AppError("INVALID_MULTIPART", 400, "Multipart body is malformed"); }
}
