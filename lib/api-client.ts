export class ApiClientError extends Error {
  readonly status: number;
  constructor(status: number, message = "Something went wrong. Try again.") { super(message); this.name = "ApiClientError"; this.status = status; }
}

function isAbort(error: unknown, signal?: AbortSignal | null) {
  return signal?.aborted || (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError");
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { ...init, headers: { Accept: "application/json", ...init?.headers }, credentials: "same-origin" }); }
  catch (error) { if (isAbort(error, init?.signal)) throw error; throw new ApiClientError(0, "Unable to reach Infographics. Try again."); }
  if (!response.ok) throw new ApiClientError(response.status);
  if (response.status === 204) return undefined as T;
  try { return await response.json() as T; }
  catch (error) { if (isAbort(error, init?.signal)) throw error; throw new ApiClientError(response.status, "Infographics returned an invalid response. Try again."); }
}

/**
 * Same as {@link apiRequest} but for endpoints that take a multipart/form-data
 * body. We omit the `Accept` header from the supplied init to keep callers from
 * clobbering the default and to ensure the form's boundary is sent.
 */
export async function apiRequestForm<T>(path: string, form: FormData, init?: RequestInit): Promise<T> {
  return apiRequest<T>(path, { ...init, method: init?.method ?? "POST", body: form });
}
