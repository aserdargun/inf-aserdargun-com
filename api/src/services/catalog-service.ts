import { compareUtcInstants, foldEvents, searchCatalog, selectWeighted, sortDueItems, utcInstantFrom } from "@inf/domain";
import type { MaterializedCatalog, MaterializedInfographic } from "@inf/contracts";
import type { EventStore } from "../storage/event-store.js";
import { AppError } from "../http/errors.js";

export interface CatalogSnapshot { catalog: MaterializedCatalog; infographics: MaterializedInfographic[]; }

/** Reads and folds the immutable event stream exactly once for each handler request. */
export class CatalogService {
  constructor(private readonly events: Pick<EventStore, "readAll">) {}

  async snapshot(): Promise<CatalogSnapshot> {
    const result = foldEvents(await this.events.readAll());
    return { catalog: result.catalog, infographics: result.catalog.infographics.filter((item) => !result.catalog.deletedInfographicIds.includes(item.id)) };
  }

  item(snapshot: CatalogSnapshot, id: string): MaterializedInfographic {
    const item = snapshot.infographics.find((candidate) => candidate.id === id);
    if (!item) throw new AppError("NOT_FOUND", 404, "Infographic was not found");
    return item;
  }

  list(snapshot: CatalogSnapshot, query?: string): MaterializedInfographic[] {
    return query === undefined ? snapshot.infographics : searchCatalog(snapshot.infographics, query, snapshot.catalog);
  }

  surprise(snapshot: CatalogSnapshot, owner: string, now: Date): MaterializedInfographic | null {
    const counter = snapshot.infographics.reduce((total, item) => total + item.seenCount, 0);
    return selectWeighted(snapshot.infographics, `${now.toISOString().slice(0, 10)}:${owner}:${counter}`, now);
  }

  due(snapshot: CatalogSnapshot, now: Date): MaterializedInfographic[] {
    const current = utcInstantFrom(now);
    return sortDueItems(snapshot.infographics.filter((item) => !item.archived && item.reviewDueAt !== null && compareUtcInstants(utcInstantFrom(item.reviewDueAt), current) <= 0));
  }

  stats(snapshot: CatalogSnapshot, now: Date) {
    const items = snapshot.infographics;
    return {
      total: items.length,
      inbox: items.filter((item) => item.folderState === "Inbox").length,
      library: items.filter((item) => item.folderState === "Library").length,
      archive: items.filter((item) => item.folderState === "Archive").length,
      due: this.due(snapshot, now).length,
      reviewed: items.reduce((total, item) => total + item.reviewCount, 0),
      seen: items.reduce((total, item) => total + item.seenCount, 0),
    };
  }
}
