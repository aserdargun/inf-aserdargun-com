export class ApiClientError extends Error {
  readonly status: number;
  constructor(status: number, message = "Something went wrong. Try again.") { super(message); this.name = "ApiClientError"; this.status = status; }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { ...init, headers: { Accept: "application/json", ...init?.headers }, credentials: "same-origin" }); }
  catch { throw new ApiClientError(0, "Unable to reach INF. Try again."); }
  if (!response.ok) throw new ApiClientError(response.status);
  try { return await response.json() as T; }
  catch { throw new ApiClientError(response.status, "INF returned an invalid response. Try again."); }
}
