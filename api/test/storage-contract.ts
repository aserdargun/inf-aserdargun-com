import { expect } from "vitest";
import type { StoragePort } from "../src/storage/storage-port.js";

export interface StorageContractFixture {
  storage: StoragePort;
  rootId: string;
  inboxId: string;
  libraryId: string;
}

/** Shared, implementation-agnostic StoragePort behavior. */
export async function assertStorageContract(fixture: StorageContractFixture): Promise<void> {
  const created = await fixture.storage.createFile({
    name: "contract.png",
    mimeType: "image/png",
    parentId: fixture.inboxId,
    bytes: Buffer.from("original bytes"),
    appProperties: { infSha256: "a".repeat(64), infId: "fixture-id" },
  });

  expect(created.parentIds).toEqual([fixture.inboxId]);
  expect(created.appProperties).toEqual({ infSha256: "a".repeat(64), infId: "fixture-id" });
  expect(await fixture.storage.readFile(created.id)).toEqual(Buffer.from("original bytes"));
  expect(await fixture.storage.findByAppProperty(fixture.rootId, "infSha256", "a".repeat(64)))
    .toEqual([created]);
  expect(await fixture.storage.isDescendant(created.id, fixture.rootId)).toBe(true);
  expect(await fixture.storage.isDescendant(fixture.rootId, fixture.rootId)).toBe(true);

  await fixture.storage.moveFile(created.id, fixture.inboxId, fixture.libraryId);
  expect(await fixture.storage.listChildren(fixture.inboxId)).toEqual([]);
  expect(await fixture.storage.listChildren(fixture.libraryId)).toEqual([
    expect.objectContaining({ id: created.id, parentIds: [fixture.libraryId] }),
  ]);

  await fixture.storage.trashFile(created.id);
  expect(await fixture.storage.listChildren(fixture.libraryId)).toEqual([]);
}
