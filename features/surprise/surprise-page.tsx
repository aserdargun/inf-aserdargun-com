"use client";

import type { SurpriseResponse } from "@inf/contracts";
import { Sparkles } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageState, RetryButton } from "../../components/ui/page-state";
import { apiRequest } from "../../lib/api-client";
import { routes } from "../../lib/routes";

type State = "loading" | "empty" | "error" | "success";

export function SurprisePage() {
  const [state, setState] = useState<State>("loading");
  const [item, setItem] = useState<SurpriseResponse["infographic"]>(null);
  const [selecting, setSelecting] = useState(false);
  const started = useRef(false);
  const inflight = useRef(false);
  const current = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const deferredAbort = useRef<number | null>(null);

  const select = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setSelecting(true);
    const requestId = ++current.current;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    if (!item) setState("loading");
    try {
      // GET /api/surprise is the single, already-persisted seen action. Never pair it with /seen.
      const response = await apiRequest<SurpriseResponse>("/api/surprise", { signal: nextController.signal });
      if (requestId !== current.current || nextController.signal.aborted) return;
      setItem(response.infographic);
      setState(response.infographic ? "success" : "empty");
    } catch (error) {
      if (nextController.signal.aborted || requestId !== current.current) return;
      setState("error");
    } finally {
      if (requestId === current.current) { inflight.current = false; setSelecting(false); }
    }
  }, [item]);

  useEffect(() => {
    // Strict Mode repeats effects, not the intentional visit. The ref makes that repeat inert.
    if (deferredAbort.current !== null) { window.clearTimeout(deferredAbort.current); deferredAbort.current = null; }
    if (!started.current) { started.current = true; void select(); }
    return () => { deferredAbort.current = window.setTimeout(() => controller.current?.abort(), 0); };
  }, [select]);

  return <div className="learning-page surprise-page"><header><h1>Surprise</h1><p>A different infographic for your attention.</p></header>{state === "loading" ? <PageState kind="loading" title="Finding an infographic…" /> : null}{state === "error" ? <PageState action={<RetryButton onRetry={() => void select()} />} kind="error" title="A surprise could not be loaded. Try again." /> : null}{state === "empty" ? <PageState action={<a className="button button--primary" href={routes.library}>Go to Library</a>} kind="empty" title="No active infographics are available." /> : null}{state === "success" && item ? <section aria-label="Selected infographic" className="surprise-selection"><div className="learning-media"><Image alt={item.title} fill priority sizes="(max-width: 767px) calc(100vw - 40px), min(900px, 70vw)" src={`/api/public/images/${item.originalDriveFileId}`} /></div><h2>{item.title}</h2><div className="learning-actions"><button className="button button--primary" disabled={selecting} onClick={() => void select()} type="button"><Sparkles aria-hidden="true" size={20} strokeWidth={1.75} />Show another</button><a className="button button--secondary" href={`/infographic/${item.id}`}>Open infographic</a></div></section> : null}</div>;
}
