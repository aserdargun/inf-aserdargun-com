import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiClientError, apiRequest, apiRequestForm } from "../lib/api-client";

afterEach(() => vi.unstubAllGlobals());

describe("apiRequest", () => {
  test("returns a typed safe error without exposing a failed response body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "private implementation detail" }), { status: 503 })));
    await expect(apiRequest("/api/settings/stats")).rejects.toMatchObject({ name: "ApiClientError", status: 503, message: "Something went wrong. Try again." } satisfies Partial<ApiClientError>);
  });

  test("reports network failures with a safe actionable message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(apiRequest("/api/infographics")).rejects.toMatchObject({ name: "ApiClientError", status: 0, message: "Unable to reach Infographics. Try again." } satisfies Partial<ApiClientError>);
  });

  test("preserves an abort while fetch is pending", async () => {
    const controller = new AbortController(); const aborted = new DOMException("cancelled", "AbortError"); controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(aborted));
    await expect(apiRequest("/api/infographics", { signal: controller.signal })).rejects.toBe(aborted);
  });

  test("preserves an abort while reading a response body", async () => {
    const controller = new AbortController(); const aborted = new DOMException("cancelled", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockImplementation(async () => { controller.abort(); throw aborted; }) } as unknown as Response));
    await expect(apiRequest("/api/infographics", { signal: controller.signal })).rejects.toBe(aborted);
  });

  test("keeps malformed response bodies safe", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockRejectedValue(new SyntaxError("invalid JSON")) } as unknown as Response));
    await expect(apiRequest("/api/infographics")).rejects.toMatchObject({ name: "ApiClientError", status: 200, message: "Infographics returned an invalid response. Try again." } satisfies Partial<ApiClientError>);
  });
});


test.each(["GET", "POST"])("bounds a stalled %s request and preserves retry safety", async (method) => {
  vi.stubGlobal("fetch", vi.fn((_path, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  })));
  await expect(apiRequest("/api/infographics", { method, timeoutMs: 10 })).rejects.toMatchObject({
    status: 0, message: method === "GET" ? "Infographics took too long to respond. Try again." : "The request timed out. Check whether your change was saved before trying again.",
  });
});

test("keeps a deadline through response body consumption", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_path, init) => ({ ok: true, status: 200, json: () => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  }) })));
  await expect(apiRequest("/api/infographics", { timeoutMs: 10 })).rejects.toMatchObject({ status: 0, message: "Infographics took too long to respond. Try again." });
});

test("supports Headers and leaves multipart boundary generation to the browser", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  await apiRequestForm("/api/infographics", new FormData(), { headers: new Headers({ "Content-Type": "multipart/form-data", "X-Test": "preserved" }) });
  const init = fetcher.mock.calls[0][1];
  expect(init.headers.get("Content-Type")).toBeNull();
  expect(init.headers.get("X-Test")).toBe("preserved");
  expect(init.headers.get("Accept")).toBe("application/json");
});
