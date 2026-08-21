import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiClientError, apiRequest } from "../lib/api-client";

afterEach(() => vi.unstubAllGlobals());

describe("apiRequest", () => {
  test("returns a typed safe error without exposing a failed response body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "private implementation detail" }), { status: 503 })));
    await expect(apiRequest("/api/settings/stats")).rejects.toMatchObject({ name: "ApiClientError", status: 503, message: "Something went wrong. Try again." } satisfies Partial<ApiClientError>);
  });

  test("reports network failures with a safe actionable message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(apiRequest("/api/infographics")).rejects.toMatchObject({ name: "ApiClientError", status: 0, message: "Unable to reach INF. Try again." } satisfies Partial<ApiClientError>);
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
    await expect(apiRequest("/api/infographics")).rejects.toMatchObject({ name: "ApiClientError", status: 200, message: "INF returned an invalid response. Try again." } satisfies Partial<ApiClientError>);
  });
});
