"use client";

import { PublicInfographicSchema, type PublicInfographic } from "@inf/contracts/public";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, apiRequest } from "../../lib/api-client";

type State = "loading" | "ready" | "missing" | "error";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date = (value: string) => new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
function idFromPathname(pathname: string) { const match = pathname.match(/^\/view\/([^/]+)\/?$/); return match && UUID.test(match[1]) ? match[1] : null; }

export function PublicDetail() {
  const [state, setState] = useState<State>("loading"); const [item, setItem] = useState<PublicInfographic | null>(null);
  const controller = useRef<AbortController | null>(null); const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = idFromPathname(window.location.pathname); if (!id) { setItem(null); setState("missing"); return; }
    controller.current?.abort(); const signal = new AbortController(); controller.current = signal; const active = ++requestId.current; setState("loading");
    try { const data = PublicInfographicSchema.parse(await apiRequest<unknown>(`/api/public/infographics/${id}`, { signal: signal.signal })); if (active !== requestId.current) return; setItem(data); setState("ready"); }
    catch (error) { if (signal.signal.aborted || active !== requestId.current) return; setItem(null); setState(error instanceof ApiClientError && error.status === 404 ? "missing" : "error"); }
  }, []);
  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);
  return <section className="public-detail" aria-busy={state === "loading"}><a className="public-detail__back" href="/view/">Back to Infographics</a>{state === "loading" && <p className="public-state">Loading infographic…</p>}{state === "missing" && <div className="public-state"><p>This infographic is not available.</p><a className="button button--secondary" href="/view/">Back to Infographics</a></div>}{state === "error" && <div className="public-state public-state--error"><p>This infographic is unavailable right now.</p><button type="button" className="button button--secondary" onClick={() => void load()}>Try again</button></div>}{state === "ready" && item && <><header><h1>{item.title}</h1><time dateTime={item.publishedAt}>{date(item.publishedAt)}</time></header><img className="public-detail__image" src={item.imageUrl} alt={item.title} /><p className="public-view-only">View only</p></>}</section>;
}
