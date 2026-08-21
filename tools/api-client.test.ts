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
});
