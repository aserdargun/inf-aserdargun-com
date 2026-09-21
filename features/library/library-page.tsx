"use client";

import type { OwnerCatalogResponse } from "@inf/contracts";
import { Library as LibraryIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "../../components/ui/page-header";
import { PageState, RetryButton } from "../../components/ui/page-state";
import { apiRequest } from "../../lib/api-client";
import { routes } from "../../lib/routes";
import { LibraryFilters, type LibraryFiltersValue } from "./library-filters";
import { LibraryGrid } from "./library-grid";
import { LibraryPager } from "./library-pager";

type LibraryState = "loading" | "empty" | "no-results" | "error" | "success";
const LIBRARY_PAGE_SIZE = 24;
const defaultFilters: LibraryFiltersValue = { q: "", category: "", tag: "", favorite: false, sort: "recent" };
function normalized(value: string) { return value.normalize("NFKC").trim().toLocaleLowerCase("en-US"); }
function parsePage(value: string | null): number {
  if (value === null) return 1;
  const parsed = /^\d+$/.test(value) ? Number(value) : 1;
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}
function parseFilters(search = window.location.search): { filters: LibraryFiltersValue; page: number } {
  const params = new URLSearchParams(search);
  return {
    page: parsePage(params.get("page")),
    filters: {
      q: params.get("q")?.trim() ?? "",
      category: normalized(params.get("category") ?? ""),
      tag: normalized(params.get("tag") ?? ""),
      favorite: params.get("favorite") === "true",
      sort: params.get("sort") === "least-seen" ? "least-seen" : "recent",
    },
  };
}
function filterUrl(value: LibraryFiltersValue, page: number) {
  const params = new URLSearchParams();
  if (value.q) params.set("q", value.q); if (value.category) params.set("category", value.category); if (value.tag) params.set("tag", value.tag); if (value.favorite) params.set("favorite", "true"); if (value.sort !== "recent") params.set("sort", value.sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString(); return `${routes.library}${query ? `?${query}` : ""}`;
}
function hasActiveFilters(value: LibraryFiltersValue) { return value.q !== "" || value.category !== "" || value.tag !== "" || value.favorite || value.sort !== "recent"; }
function catalogUrl(value: LibraryFiltersValue, page: number) {
  const params = new URLSearchParams();
  if (value.q) params.set("q", value.q); if (value.category) params.set("category", value.category); if (value.tag) params.set("tag", value.tag); if (value.favorite) params.set("favorite", "true");
  params.set("sort", value.sort); if (page > 1) params.set("page", String(page)); params.set("pageSize", String(LIBRARY_PAGE_SIZE));
  return `/api/infographics?${params.toString()}`;
}

export function LibraryPage() {
  const deferSearch = useRef(false);
  const [state, setState] = useState<LibraryState>("loading"); const [catalog, setCatalog] = useState<OwnerCatalogResponse | null>(null); const [filters, setFilters] = useState<LibraryFiltersValue>(defaultFilters); const [page, setPage] = useState(1); const [ready, setReady] = useState(false); const requestId = useRef(0); const activeRequest = useRef<AbortController | null>(null);
  const load = useCallback(async (nextFilters: LibraryFiltersValue, nextPage: number) => {
    const id = ++requestId.current; activeRequest.current?.abort(); const controller = new AbortController(); activeRequest.current = controller;
    setState("loading");
    try {
      const next = await apiRequest<OwnerCatalogResponse>(catalogUrl(nextFilters, nextPage), { signal: controller.signal });
      if (id !== requestId.current) return;
      if (next.page !== nextPage) {
        setPage(next.page);
        window.history.replaceState(null, "", filterUrl(nextFilters, next.page));
      }
      setCatalog(next); setState(next.infographics.length > 0 ? "success" : hasActiveFilters(nextFilters) || nextPage > 1 ? "no-results" : "empty");
    } catch {
      if (controller.signal.aborted || id !== requestId.current) return;
      setState("error");
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, []);
  useEffect(() => { const restore = () => { deferSearch.current = false; const parsed = parseFilters(); setFilters(parsed.filters); setPage(parsed.page); }; restore(); setReady(true); window.addEventListener("popstate", restore); return () => { requestId.current += 1; activeRequest.current?.abort(); activeRequest.current = null; window.removeEventListener("popstate", restore); }; }, []);
  useEffect(() => {
    if (!ready) return;
    // Keep input immediate, but send only the settled query. Invalidate older
    // responses immediately so they cannot render during the debounce window.
    requestId.current += 1;
    activeRequest.current?.abort();
    const timer = setTimeout(() => { deferSearch.current = false; void load(filters, page); }, deferSearch.current ? 200 : 0);
    return () => { clearTimeout(timer); requestId.current += 1; activeRequest.current?.abort(); };
  }, [filters, page, load, ready]);
  const updateFilters = useCallback((next: LibraryFiltersValue) => { deferSearch.current = next.q !== filters.q; setFilters(next); setPage(1); window.history.pushState(null, "", filterUrl(next, 1)); }, [filters.q]);
  const goToPage = useCallback((next: number) => {
    if (!catalog) return;
    if (next < 1 || next > catalog.totalPages || next === page) return;
    deferSearch.current = false;
    setPage(next);
    window.history.pushState(null, "", filterUrl(filters, next));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [catalog, filters, page]);
  const heading = <PageHeader description="Your organized infographics." title="Library" />;
  if (state === "loading" && !catalog) return <section className="library-page">{heading}<PageState icon={LibraryIcon} kind="loading" layout="compact" title="Loading Library…" /></section>;
  if (state === "error") return <section className="library-page">{heading}<PageState action={<RetryButton onRetry={() => void load(filters, page)} />} icon={LibraryIcon} kind="error" layout="compact" title="Library could not be loaded. Try again." /></section>;
  if (state === "empty") return <section className="library-page">{heading}<PageState action={<a className="button button--primary" href={routes.add}>Add infographic</a>} description="Add an image to begin your Library." icon={LibraryIcon} kind="empty" layout="compact" title="Library is empty." /></section>;
  return <section className="library-page">{heading}<LibraryFilters categories={catalog!.categories} onChange={updateFilters} onClear={() => updateFilters(defaultFilters)} tags={catalog!.tags} value={filters} />{state === "loading" ? <PageState icon={LibraryIcon} kind="loading" layout="compact" title="Loading Library…" /> : state === "no-results" ? <PageState action={<button className="button button--secondary" onClick={() => updateFilters(defaultFilters)} type="button">Clear filters</button>} icon={LibraryIcon} kind="empty" layout="compact" title="No infographics match these filters." /> : <><LibraryGrid items={catalog!.infographics} /><LibraryPager page={catalog!.page} totalItems={catalog!.totalItems} totalPages={catalog!.totalPages} onChange={goToPage} /></>}</section>;
}
