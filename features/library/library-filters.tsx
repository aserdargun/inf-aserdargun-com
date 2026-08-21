"use client";

import type { Category, Tag } from "@inf/contracts";

export type LibrarySort = "recent" | "least-seen";
export interface LibraryFiltersValue { q: string; category: string; tag: string; favorite: boolean; source: boolean; sort: LibrarySort; }
interface LibraryFiltersProps { categories: readonly Category[]; tags: readonly Tag[]; value: LibraryFiltersValue; onChange: (next: LibraryFiltersValue) => void; onClear: () => void; }

export function LibraryFilters({ categories, tags, value, onChange, onClear }: LibraryFiltersProps) {
  const update = <K extends keyof LibraryFiltersValue>(key: K, next: LibraryFiltersValue[K]) => onChange({ ...value, [key]: next });
  return <form aria-label="Library filters" className="library-filters" onSubmit={(event) => event.preventDefault()}>
    <label className="library-filters__search"><span className="visually-hidden">Search library</span><input aria-label="Search library" onChange={(event) => update("q", event.currentTarget.value)} placeholder="Search library" type="search" value={value.q} /></label>
    <label>Category<select aria-label="Category" onChange={(event) => update("category", event.currentTarget.value)} value={value.category}><option value="">Category</option>{categories.map((entry) => <option key={entry.id} value={entry.slug}>{entry.displayName}</option>)}</select></label>
    <label>Tag<select aria-label="Tag" onChange={(event) => update("tag", event.currentTarget.value)} value={value.tag}><option value="">Tag</option>{tags.map((entry) => <option key={entry.id} value={entry.slug}>{entry.displayName}</option>)}</select></label>
    <label className="library-filters__check"><input aria-label="Favorite" checked={value.favorite} onChange={(event) => update("favorite", event.currentTarget.checked)} type="checkbox" /><span>Favorite</span></label>
    <label className="library-filters__check"><input aria-label="Source" checked={value.source} onChange={(event) => update("source", event.currentTarget.checked)} type="checkbox" /><span>Source</span></label>
    <label>Sort<select aria-label="Sort" onChange={(event) => update("sort", event.currentTarget.value as LibrarySort)} value={value.sort}><option value="recent">Recently added</option><option value="least-seen">Least recently seen</option></select></label>
    <button className="button button--quiet" onClick={onClear} type="button">Clear filters</button>
  </form>;
}
