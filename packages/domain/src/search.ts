import type { Category, MaterializedInfographic, Tag } from "@inf/contracts";

export interface SearchTaxonomy {
  categories?: readonly Category[];
  tags?: readonly Tag[];
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();
}

function taxonomyNames<T extends { id: string; displayName: string; normalizedName: string }>(
  ids: readonly string[],
  entries: readonly T[] | undefined,
): string[] {
  if (entries === undefined) return [];

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return ids.flatMap((id) => {
    const entry = byId.get(id);
    return entry === undefined ? [] : [entry.displayName, entry.normalizedName];
  });
}

function searchableText(item: MaterializedInfographic, taxonomy: SearchTaxonomy): string {
  return [
    item.title,
    item.notes,
    item.sourceAuthor,
    item.sourceUrl,
    ...taxonomyNames(item.categoryIds, taxonomy.categories),
    ...taxonomyNames(item.tagIds, taxonomy.tags),
  ]
    .filter((value): value is string => value !== null)
    .map(normalizeSearchText)
    .join(" ");
}

/**
 * Performs deterministic normalized substring search over catalog metadata.
 * Taxonomy labels are resolved only when their optional display context is supplied.
 */
export function searchCatalog(
  items: readonly MaterializedInfographic[],
  query: string,
  taxonomy: SearchTaxonomy = {},
): MaterializedInfographic[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery === "") return [...items];

  return items.filter((item) => searchableText(item, taxonomy).includes(normalizedQuery));
}
