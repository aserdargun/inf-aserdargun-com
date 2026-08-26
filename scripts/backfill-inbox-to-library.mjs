// Backfill: every infographic whose canonical state is still "Inbox" (from
// before the auto-Library change) gets its Drive file moved from the inbox
// folder to the library folder and an `infographic.promotedToLibrary` event
// is appended. The script is idempotent: items already carrying a promotion
// event are skipped, and re-running after a partial failure is safe.
//
// Run with: node scripts/backfill-inbox-to-library.mjs
// Local:    INF_LOCAL_RUNTIME=development INF_LOCAL_STORAGE_MODE=true \
//           INF_LOCAL_STORAGE_ROOT=.inf-local-storage \
//           INF_LOCAL_AUTH_BYPASS=true INF_LOCAL_PROXY_MODE=bypass \
//           INF_LOCAL_PROXY_TOKEN=$(openssl rand -hex 32) \
//           node scripts/backfill-inbox-to-library.mjs
import { randomUUID } from "node:crypto";
import { createRuntime } from "../api-dist/dist/index.js";
import { foldEvents } from "../api-dist/dist/index.js";

const dependencies = createRuntime();
const { storage, events } = dependencies.owner;

function log(line) {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

async function main() {
  const inboxFolderId = dependencies.owner.inboxFolderId;
  const libraryFolderId = dependencies.owner.libraryFolderId;
  if (!inboxFolderId || !libraryFolderId) {
    throw new Error("Inbox and library folder IDs must be configured for backfill.");
  }

  log("Reading event log…");
  const rawEvents = await events.readAll();
  const { catalog } = foldEvents(rawEvents);
  const items = catalog.infographics;
  log(`Materialized ${items.length} infographics.`);

  const inboxItems = items.filter((item) => item.folderState === "Inbox" && !item.archived);
  log(`Found ${inboxItems.length} non-archived Inbox item(s) to promote.`);

  if (inboxItems.length === 0) {
    log("Nothing to do. Exiting.");
    return;
  }

  let moved = 0;
  let alreadyInLibrary = 0;
  let promoted = 0;
  let failed = 0;

  for (const item of inboxItems) {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    const originalId = item.originalDriveFileId;

    let fileIsInLibrary = false;
    try {
      fileIsInLibrary = await storage.isDescendant(originalId, libraryFolderId);
    } catch (error) {
      log(`SKIP ${item.id} (${item.title}): cannot resolve Drive file ${originalId} — ${String(error)}`);
      failed += 1;
      continue;
    }
    if (fileIsInLibrary) {
      alreadyInLibrary += 1;
    } else {
      try {
        await storage.moveFile(originalId, inboxFolderId, libraryFolderId);
        moved += 1;
        log(`moved ${item.id} (${item.title}) into library folder`);
      } catch (error) {
        log(`FAIL ${item.id} (${item.title}): Drive move failed — ${String(error)}`);
        failed += 1;
        continue;
      }
    }

    try {
      await events.append({
        eventId,
        schemaVersion: 1,
        type: "infographic.promotedToLibrary",
        occurredAt,
        infographicId: item.id,
        payload: {},
      });
      promoted += 1;
      log(`appended promotedToLibrary event for ${item.id}`);
    } catch (error) {
      log(`FAIL ${item.id} (${item.title}): could not append event — ${String(error)}`);
      failed += 1;
    }
  }

  log(`Done. moved=${moved} alreadyInLibrary=${alreadyInLibrary} promoted=${promoted} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

await main();
