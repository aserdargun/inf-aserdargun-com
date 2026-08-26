import { compareUtcInstants, foldEvents, searchCatalog, selectWeighted, sortDueItems, utcInstantFrom } from "@inf/domain";
import type { MaterializedCatalog, MaterializedInfographic, OwnerCatalogQuery } from "@inf/contracts";
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

  /** The owner Library query is a single server-side meaning for normalized search, filters, and stable sorting. */
  libraryList(snapshot: CatalogSnapshot, query: OwnerCatalogQuery): MaterializedInfographic[] {
    const categoryIds = query.category === undefined ? undefined : new Set(snapshot.catalog.categories.filter((entry) => entry.slug === query.category).map((entry) => entry.id));
    const tagIds = query.tag === undefined ? undefined : new Set(snapshot.catalog.tags.filter((entry) => entry.slug === query.tag).map((entry) => entry.id));
    if (categoryIds?.size === 0 || tagIds?.size === 0) return [];
    const searched = query.q === undefined ? snapshot.infographics : searchCatalog(snapshot.infographics, query.q, snapshot.catalog);
    return searched.filter((item) => item.folderState === "Library" && !item.archived)
      .filter((item) => categoryIds === undefined || item.categoryIds.some((id) => categoryIds.has(id)))
      .filter((item) => tagIds === undefined || item.tagIds.some((id) => tagIds.has(id)))
      .filter((item) => query.favorite === undefined || item.favorite === query.favorite)
      .sort((left, right) => query.sort === "least-seen"
        ? (left.lastSeenAt ?? "").localeCompare(right.lastSeenAt ?? "") || left.id.localeCompare(right.id)
        : right.capturedAt.localeCompare(left.capturedAt) || left.id.localeCompare(right.id));
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
      uncategorized: items.filter((item) => !item.archived && item.categoryIds.length === 0).length,
      library: items.filter((item) => !item.archived && item.categoryIds.length > 0).length,
      archive: items.filter((item) => item.archived).length,
      due: this.due(snapshot, now).length,
      reviewed: items.reduce((total, item) => total + item.reviewCount, 0),
      seen: items.reduce((total, item) => total + item.seenCount, 0),
    };
  }
}
