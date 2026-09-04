"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { PublicCatalogPageSchema, type PublicCatalogPage, type PublicInfographic } from "@inf/contracts/public";
import { useCallback, useEffect, useRef, useState } from "react";
import { MediaCanvas } from "../../components/ui/media-canvas";
import { apiRequest } from "../../lib/api-client";

type State = "loading" | "ready" | "empty" | "error";
// Aspect ratio for the public gallery is 8:5 (see .public-grid__image); we
// declare an intrinsic size to prevent CLS while the bitmap streams in.
const PUBLIC_TILE_WIDTH = 480;
const PUBLIC_TILE_HEIGHT = 300;
const publicDate = (value: string) => new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));

function PublicItem({ item, priority = "auto" }: { item: PublicInfographic; priority?: "high" | "low" | "auto" }) {
  return <article className="public-grid__item"><a href={`/view/${item.id}/`} aria-label={`Open ${item.title}`}><div className="public-grid__image"><img alt={item.title} decoding="async" fetchPriority={priority} height={PUBLIC_TILE_HEIGHT} loading={priority === "high" ? "eager" : "lazy"} src={item.thumbnailUrl} width={PUBLIC_TILE_WIDTH} /></div><span className="public-grid__caption"><strong>{item.title}</strong><time dateTime={item.publishedAt}>{publicDate(item.publishedAt)}</time></span></a></article>;
}

function parsePageFromUrl(): number {
  if (typeof window === "undefined") return 1;
  const raw = new URLSearchParams(window.location.search).get("page");
  if (raw === null) return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function buildPageHref(page: number): string {
  // Preserve the existing query string so other filters survive pagination;
  // page is intentionally always re-written from the current value.
  const url = new URL(typeof window === "undefined" ? "/view/" : window.location.href);
  url.searchParams.delete("page");
  if (page > 1) url.searchParams.set("page", String(page));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function PublicGallery() {
  const [state, setState] = useState<State>("loading");
  const [page, setPage] = useState<PublicCatalogPage | null>(null);
  const [pageNumber, setPageNumber] = useState<number>(() => parsePageFromUrl());
  const requestId = useRef(0); const controller = useRef<AbortController | null>(null);
  const load = useCallback(async (target: number) => {
    controller.current?.abort(); const active = ++requestId.current; const signal = new AbortController(); controller.current = signal; setState("loading");
    const search = new URLSearchParams();
    if (target > 1) search.set("page", String(target));
    const path = `/api/public/infographics${search.size > 0 ? `?${search.toString()}` : ""}`;
    try {
      const data = PublicCatalogPageSchema.parse(await apiRequest<unknown>(path, { signal: signal.signal }));
      if (active !== requestId.current) return;
      setPage(data);
      setState(data.items.length ? "ready" : data.totalItems === 0 ? "empty" : "ready");
    } catch {
      if (signal.signal.aborted || active !== requestId.current) return; setState("error");
    }
  }, []);
  useEffect(() => {
    // Read the current URL on mount in case SSR seeded a different page; keep
    // the user on a deep-linked page even when the shell hydrates late.
    setPageNumber(parsePageFromUrl());
    void load(parsePageFromUrl());
    return () => controller.current?.abort();
  }, [load]);
  const goTo = useCallback((next: number) => {
    if (!page || next < 1 || next > page.totalPages || next === pageNumber) return;
    setPageNumber(next);
    if (typeof window !== "undefined") {
      const target = buildPageHref(next);
      // Update the address bar so the page is shareable; a pushState keeps the
      // browser history navigable with the back button.
      window.history.pushState({ page: next }, "", target);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    void load(next);
  }, [page, pageNumber, load]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onPop() { const fromUrl = parsePageFromUrl(); if (fromUrl !== pageNumber) { setPageNumber(fromUrl); void load(fromUrl); } }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [pageNumber, load]);
  const renderItems = state === "ready" && page && page.items.length > 0;
  const showPager = state === "ready" && page !== null && page.totalPages > 1;
  return <section className="public-content" aria-busy={state === "loading"}>
    <header className="public-content__heading"><h1>Infographics</h1><p>A public collection of visual notes.</p></header>
    {state === "loading" && <p className="public-state">Loading infographics…</p>}
    {state === "empty" && <p className="public-state">No infographics are available.</p>}
    {state === "error" && <div className="public-state public-state--error"><p>This collection is unavailable right now.</p><button type="button" className="button button--secondary" onClick={() => void load(pageNumber)}>Try again</button></div>}
    {renderItems && page && (
      <>
        <div className="public-grid">{page.items.map((item, index) => <PublicItem item={item} key={item.id} priority={index < 6 ? "high" : "low"} />)}</div>
        {showPager && (
          <nav aria-label="Infographics pages" className="public-pager">
            <button aria-label="Previous page" className="button button--secondary public-pager__nav" disabled={pageNumber <= 1} onClick={() => goTo(pageNumber - 1)} type="button">
              <ChevronLeft aria-hidden="true" size={18} strokeWidth={1.75} />Previous
            </button>
            <p aria-live="polite" className="public-pager__status">
              Page <strong>{pageNumber}</strong> of <strong>{page.totalPages}</strong>
              <span className="public-pager__count"> · {page.totalItems} infographic{page.totalItems === 1 ? "" : "s"}</span>
            </p>
            <button aria-label="Next page" className="button button--secondary public-pager__nav" disabled={pageNumber >= page.totalPages} onClick={() => goTo(pageNumber + 1)} type="button">
              Next<ChevronRight aria-hidden="true" size={18} strokeWidth={1.75} />
            </button>
          </nav>
        )}
      </>
    )}
    <p className="public-view-only">View only</p>
  </section>;
}
