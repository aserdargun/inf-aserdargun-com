"use client";

import { PublicCatalogResponseSchema, type PublicInfographic } from "@inf/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../../lib/api-client";

type State = "loading" | "ready" | "empty" | "error";
const publicDate = (value: string) => new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));

function PublicItem({ item }: { item: PublicInfographic }) {
  return <article className="public-grid__item"><a href={`/view/${item.id}/`} aria-label={`Open ${item.title}`}><div className="public-grid__image"><img src={item.thumbnailUrl} alt={item.title} /></div><span className="public-grid__caption"><strong>{item.title}</strong><time dateTime={item.publishedAt}>{publicDate(item.publishedAt)}</time></span></a></article>;
}

export function PublicGallery() {
  const [state, setState] = useState<State>("loading"); const [items, setItems] = useState<PublicInfographic[]>([]);
  const requestId = useRef(0); const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    controller.current?.abort(); const active = ++requestId.current; const signal = new AbortController(); controller.current = signal; setState("loading");
    try {
      const data = PublicCatalogResponseSchema.parse(await apiRequest<unknown>("/api/public/infographics", { signal: signal.signal }));
      if (active !== requestId.current) return; setItems(data); setState(data.length ? "ready" : "empty");
    } catch {
      if (signal.signal.aborted || active !== requestId.current) return; setState("error");
    }
  }, []);
  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);
  return <section className="public-content" aria-busy={state === "loading"}><header className="public-content__heading"><h1>Infographics</h1><p>A public collection of visual notes.</p></header>{state === "loading" && <p className="public-state">Loading infographics…</p>}{state === "empty" && <p className="public-state">No infographics are available.</p>}{state === "error" && <div className="public-state public-state--error"><p>This collection is unavailable right now.</p><button type="button" className="button button--secondary" onClick={() => void load()}>Try again</button></div>}{state === "ready" && <div className="public-grid">{items.map((item) => <PublicItem key={item.id} item={item} />)}</div>}<p className="public-view-only">View only</p></section>;
}
