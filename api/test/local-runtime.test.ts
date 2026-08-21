import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRuntime } from "../src/index.js";
import { LocalDriveAdapter } from "../src/storage/local-drive-adapter.js";

const base = { INF_ALLOWED_GITHUB_USER: "aserdargun", INF_LOCAL_RUNTIME: "development", INF_LOCAL_STORAGE_MODE: "true", INF_LOCAL_AUTH_BYPASS: "true", INF_LOCAL_PROXY_MODE: "bypass", INF_LOCAL_PROXY_TOKEN: "a".repeat(32) };

describe("local runtime selection", () => {
  it("uses checkout-private local storage only with every local security gate", async () => {
    const root = await mkdtemp(join(tmpdir(), "inf-local-runtime-"));
    try {
      expect(createRuntime({ ...base, INF_LOCAL_STORAGE_ROOT: root }).owner.storage).toBeInstanceOf(LocalDriveAdapter);
      for (const override of [
        { INF_LOCAL_RUNTIME: undefined }, { INF_LOCAL_RUNTIME: "" }, { INF_LOCAL_RUNTIME: "preview" },
        { INF_LOCAL_STORAGE_MODE: undefined }, { INF_LOCAL_AUTH_BYPASS: undefined }, { INF_LOCAL_PROXY_MODE: undefined },
        { INF_LOCAL_PROXY_TOKEN: undefined }, { INF_LOCAL_PROXY_TOKEN: "short" }, { INF_LOCAL_STORAGE_ROOT: undefined },
        { NODE_ENV: "production" }, { WEBSITE_SITE_NAME: "production" }, { WEBSITE_SITE_NAME: "" },
      ]) expect(() => createRuntime({ ...base, INF_LOCAL_STORAGE_ROOT: root, ...override })).toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
