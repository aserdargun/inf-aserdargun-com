"use client";

import type { OwnerCatalogResponse } from "@inf/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageState, RetryButton } from "../../components/ui/page-state";
import { apiRequest } from "../../lib/api-client";
import { routes } from "../../lib/routes";
import { LibraryFilters, type LibraryFiltersValue } from "./library-filters";
import { LibraryGrid } from "./library-grid";

type LibraryState = "loading" | "empty" | "no-results" | "error" | "success";
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
function hasActiveFilters(value: LibraryFiltersValue) { return value.q !== "" || value.category !== "" || value.tag !== "" || value.favorite || value.source || value.sort !== "recent"; }
function catalogUrl(value: LibraryFiltersValue) {
  const params = new URLSearchParams();
  if (value.q) params.set("q", value.q); if (value.category) params.set("category", value.category); if (value.tag) params.set("tag", value.tag); if (value.favorite) params.set("favorite", "true"); if (value.source) params.set("source", "true");
  params.set("sort", value.sort); return `/api/infographics?${params.toString()}`;
}

export function LibraryPage() {
  const [state, setState] = useState<LibraryState>("loading"); const [catalog, setCatalog] = useState<OwnerCatalogResponse | null>(null); const [filters, setFilters] = useState<LibraryFiltersValue>(defaultFilters); const [ready, setReady] = useState(false); const requestId = useRef(0); const lifecycle = useRef<AbortController | null>(null);
  const load = useCallback(async (nextFilters: LibraryFiltersValue) => {
    const id = ++requestId.current; const signal = lifecycle.current?.signal;
    setState("loading");
    try {
      const next = await apiRequest<OwnerCatalogResponse>(catalogUrl(nextFilters), { signal });
      if (id !== requestId.current) return;
      setCatalog(next); setState(next.infographics.length > 0 ? "success" : hasActiveFilters(nextFilters) ? "no-results" : "empty");
    } catch {
      if (signal?.aborted || id !== requestId.current) return;
      setState("error");
    }
  }, []);
  useEffect(() => { const controller = new AbortController(); lifecycle.current = controller; const restore = () => setFilters(parseFilters()); restore(); setReady(true); window.addEventListener("popstate", restore); return () => { requestId.current += 1; controller.abort(); if (lifecycle.current === controller) lifecycle.current = null; window.removeEventListener("popstate", restore); }; }, []);
  useEffect(() => { if (ready) void load(filters); }, [filters, load, ready]);
  const updateFilters = useCallback((next: LibraryFiltersValue) => { setFilters(next); window.history.pushState(null, "", filterUrl(next)); }, []);
  const heading = <header className="library-page__header"><h1>Library</h1><p>Your organized infographics.</p></header>;
  if (state === "loading" && !catalog) return <section className="library-page">{heading}<PageState kind="loading" title="Loading Library…" /></section>;
  if (state === "error") return <section className="library-page">{heading}<PageState action={<RetryButton onRetry={() => void load(filters)} />} kind="error" title="Library could not be loaded. Try again." /></section>;
  if (state === "empty") return <section className="library-page">{heading}<PageState action={<a className="button button--primary" href={routes.inbox}>Go to Inbox</a>} description="Organize an item from Inbox to add it here." kind="empty" title="Library is empty." /></section>;
  return <section className="library-page">{heading}<LibraryFilters categories={catalog!.categories} onChange={updateFilters} onClear={() => updateFilters(defaultFilters)} tags={catalog!.tags} value={filters} />{state === "loading" ? <PageState kind="loading" title="Loading Library…" /> : state === "no-results" ? <PageState action={<button className="button button--secondary" onClick={() => updateFilters(defaultFilters)} type="button">Clear filters</button>} kind="empty" title="No infographics match these filters." /> : <LibraryGrid items={catalog!.infographics} />}</section>;
}
