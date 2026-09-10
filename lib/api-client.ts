export class ApiClientError extends Error {
  readonly status: number;
  constructor(status: number, message = "Something went wrong. Try again.") { super(message); this.name = "ApiClientError"; this.status = status; }
}

export interface ApiRequestOptions extends RequestInit { timeoutMs?: number; }

function isAbort(error: unknown, signal?: AbortSignal | null) {
  return signal?.aborted || (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError");
}

export async function apiRequest<T>(path: string, init?: ApiRequestOptions): Promise<T> {
  const { timeoutMs, ...request } = init ?? {};
  const mutation = !["GET", "HEAD"].includes((request.method ?? "GET").toUpperCase());
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs ?? (mutation ? 120_000 : 30_000));
  const signal = request.signal ? AbortSignal.any([request.signal, deadline.signal]) : deadline.signal;
  const headers = new Headers(request.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  try {
    let response: Response;
    try {
      response = await fetch(path, { ...request, signal, cache: "no-store", headers, credentials: "same-origin" });
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      throw new ApiClientError(0, "Unable to reach Infographics. Try again.");
    }
    if (!response.ok) throw new ApiClientError(response.status);
    if (response.status === 204) return undefined as T;
    try { return await response.json() as T; }
    catch (error) {
      if (isAbort(error, signal)) throw error;
      throw new ApiClientError(response.status, "Infographics returned an invalid response. Try again.");
    }
  } catch (error) {
    if (request.signal?.aborted) throw error;
    if (deadline.signal.aborted) throw new ApiClientError(0, mutation
      ? "The request timed out. Check whether your change was saved before trying again."
      : "Infographics took too long to respond. Try again.");
    throw error;
  } finally { clearTimeout(timer); }
}

/** Let the browser supply the multipart boundary. */
export async function apiRequestForm<T>(path: string, form: FormData, init?: ApiRequestOptions): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.delete("Content-Type");
  return apiRequest<T>(path, { ...init, headers, method: init?.method ?? "POST", body: form });
}
