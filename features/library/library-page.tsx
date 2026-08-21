"use client";

import type { OwnerCatalogResponse } from "@inf/contracts";
import { searchCatalog } from "@inf/domain";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageState, RetryButton } from "../../components/ui/page-state";
import { apiRequest } from "../../lib/api-client";
import { routes } from "../../lib/routes";
import { LibraryFilters, type LibraryFiltersValue, type LibrarySort } from "./library-filters";
import { LibraryGrid } from "./library-grid";

type LibraryState = "loading" | "empty" | "error" | "success";
const defaultFilters: LibraryFiltersValue = { q: "", category: "", tag: "", favorite: false, source: false, sort: "recent" };
function normalized(value: string) { return value.normalize("NFKC").trim().toLocaleLowerCase("en-US"); }
function parseFilters(search = window.location.search): LibraryFiltersValue {
  const params = new URLSearchParams(search);
  return { q: params.get("q")?.trim() ?? "", category: normalized(params.get("category") ?? ""), tag: normalized(params.get("tag") ?? ""), favorite: params.get("favorite") === "true", source: params.get("source") === "true", sort: params.get("sort") === "least-seen" ? "least-seen" : "recent" };
}
function filterUrl(value: LibraryFiltersValue) {
  const params = new URLSearchParams();
  if (value.q) params.set("q", value.q); if (value.category) params.set("category", value.category); if (value.tag) params.set("tag", value.tag); if (value.favorite) params.set("favorite", "true"); if (value.source) params.set("source", "true"); if (value.sort !== "recent") params.set("sort", value.sort);
  const query = params.toString(); return `${routes.library}${query ? `?${query}` : ""}`;
}
function compareItems(sort: LibrarySort, left: { capturedAt: string; lastSeenAt: string | null; id: string }, right: { capturedAt: string; lastSeenAt: string | null; id: string }) {
  if (sort === "recent") return right.capturedAt.localeCompare(left.capturedAt) || left.id.localeCompare(right.id);
  return (left.lastSeenAt ?? "").localeCompare(right.lastSeenAt ?? "") || left.id.localeCompare(right.id);
}

export function LibraryPage() {
  const [state, setState] = useState<LibraryState>("loading"); const [catalog, setCatalog] = useState<OwnerCatalogResponse | null>(null); const [filters, setFilters] = useState<LibraryFiltersValue>(defaultFilters);
  const load = useCallback(async () => { setState("loading"); try { const next = await apiRequest<OwnerCatalogResponse>("/api/infographics"); setCatalog(next); setState(next.infographics.some((item) => item.folderState === "Library" && !item.archived) ? "success" : "empty"); } catch { setState("error"); } }, []);
  useEffect(() => { setFilters(parseFilters()); void load(); }, [load]);
  useEffect(() => { const restore = () => setFilters(parseFilters()); window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore); }, []);
  const updateFilters = useCallback((next: LibraryFiltersValue) => { setFilters(next); window.history.pushState(null, "", filterUrl(next)); }, []);
  const results = useMemo(() => {
    if (!catalog) return [];
    const categoryIds = new Set(catalog.categories.filter((entry) => entry.slug === filters.category).map((entry) => entry.id));
    const tagIds = new Set(catalog.tags.filter((entry) => entry.slug === filters.tag).map((entry) => entry.id));
    return searchCatalog(catalog.infographics, filters.q, catalog).filter((item) => item.folderState === "Library" && !item.archived)
      .filter((item) => categoryIds.size === 0 || item.categoryIds.some((entry) => categoryIds.has(entry)))
      .filter((item) => tagIds.size === 0 || item.tagIds.some((entry) => tagIds.has(entry)))
      .filter((item) => !filters.favorite || item.favorite).filter((item) => !filters.source || item.sourceUrl !== null)
      .sort((left, right) => compareItems(filters.sort, left, right));
  }, [catalog, filters]);
  const heading = <header className="library-page__header"><h1>Library</h1><p>Your organized infographics.</p></header>;
  if (state === "loading") return <section className="library-page">{heading}<PageState kind="loading" title="Loading Library…" /></section>;
  if (state === "error") return <section className="library-page">{heading}<PageState action={<RetryButton onRetry={() => void load()} />} kind="error" title="Library could not be loaded. Try again." /></section>;
  if (state === "empty") return <section className="library-page">{heading}<PageState action={<a className="button button--primary" href={routes.inbox}>Go to Inbox</a>} description="Organize an item from Inbox to add it here." kind="empty" title="Library is empty." /></section>;
  return <section className="library-page">{heading}<LibraryFilters categories={catalog!.categories} onChange={updateFilters} onClear={() => updateFilters(defaultFilters)} tags={catalog!.tags} value={filters} />{results.length === 0 ? <PageState action={<button className="button button--secondary" onClick={() => updateFilters(defaultFilters)} type="button">Clear filters</button>} kind="empty" title="No infographics match these filters." /> : <LibraryGrid items={results} />}</section>;
}
