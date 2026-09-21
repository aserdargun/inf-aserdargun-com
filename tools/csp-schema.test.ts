import { expect, test, vi } from "vitest";
import { z } from "zod";

test("browser public and owner schemas validate without probing or compiling dynamic code", async () => {
  vi.resetModules();
  const previousJitless = z.config().jitless;
  vi.stubGlobal("window", {});
  const dynamicCode = vi.spyOn(globalThis, "Function").mockImplementation(() => {
    throw new Error("Blocked by strict CSP");
  });
  try {
    const { PublicCatalogPageSchema } = await import("../packages/contracts/src/public");
    const { SessionResponseSchema } = await import("../packages/contracts/src/api");
    expect(PublicCatalogPageSchema.safeParse({ items: [], page: 1, pageSize: 12, totalItems: 0, totalPages: 0 }).success).toBe(true);
    expect(PublicCatalogPageSchema.safeParse({ items: [], page: -1 }).success).toBe(false);
    expect(SessionResponseSchema.safeParse({ authenticated: true, owner: "owner", mode: "github" }).success).toBe(true);
    expect(SessionResponseSchema.safeParse({ authenticated: false }).success).toBe(false);
    expect(dynamicCode).not.toHaveBeenCalled();
  } finally {
    dynamicCode.mockRestore();
    z.config({ jitless: previousJitless });
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
