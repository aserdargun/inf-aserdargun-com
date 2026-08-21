import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRuntime } from "../src/index.js";
import { LocalDriveAdapter } from "../src/storage/local-drive-adapter.js";

const base = { INF_ALLOWED_GITHUB_USER: "aserdargun", INF_LOCAL_STORAGE_MODE: "true", INF_LOCAL_AUTH_BYPASS: "true", INF_LOCAL_PROXY_MODE: "bypass", INF_LOCAL_PROXY_TOKEN: "a".repeat(32) };

describe("local runtime selection", () => {
  it("uses checkout-private local storage only with every local security gate", async () => {
    const root = await mkdtemp(join(tmpdir(), "inf-local-runtime-"));
    try {
      expect(createRuntime({ ...base, INF_LOCAL_STORAGE_ROOT: root }).owner.storage).toBeInstanceOf(LocalDriveAdapter);
      expect(() => createRuntime({ ...base, INF_LOCAL_STORAGE_ROOT: root, WEBSITE_SITE_NAME: "production" })).toThrow(/INF_PRIVATE_DRIVE_FOLDER_ID/);
      expect(() => createRuntime({ ...base, INF_LOCAL_STORAGE_ROOT: root, INF_LOCAL_PROXY_TOKEN: "short" })).toThrow(/INF_PRIVATE_DRIVE_FOLDER_ID/);
      expect(() => createRuntime({ ...base, INF_LOCAL_STORAGE_ROOT: root, INF_LOCAL_AUTH_BYPASS: "false" })).toThrow(/INF_PRIVATE_DRIVE_FOLDER_ID/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
