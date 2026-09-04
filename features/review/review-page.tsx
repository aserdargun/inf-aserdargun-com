"use client";

import type { DueReviewResponse, MaterializedInfographic, ReviewRating } from "@inf/contracts";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { MediaCanvas } from "../../components/ui/media-canvas";
import { PageHeader } from "../../components/ui/page-header";
import { PageState, RetryButton } from "../../components/ui/page-state";
import { apiRequest } from "../../lib/api-client";
import { routes } from "../../lib/routes";
import { RatingControls, ratingFromShortcut } from "./rating-controls";

type State = "loading" | "empty" | "error" | "success";
const isEditable = (target: EventTarget | null) => target instanceof HTMLElement && (target.matches("input, textarea, select, button, [contenteditable]") || Boolean(target.closest("[role='dialog']")));
const isShortcutSuppressed = (event: KeyboardEvent) => event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isEditable(event.target) || document.querySelector("[role='dialog']") !== null;

export function ReviewPage() {
  const [state, setState] = useState<State>("loading");
  const [item, setItem] = useState<MaterializedInfographic | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const savingRef = useRef(false);
  const initialLoadStarted = useRef(false);
  const deferredAbort = useRef<number | null>(null);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setState("loading");
    try {
      const response = await apiRequest<DueReviewResponse>("/api/review", { signal: next.signal });
      if (id !== requestId.current || next.signal.aborted) return;
      const nextItem = response.infographics[0] ?? null;
      setItem(nextItem); setState(nextItem ? "success" : "empty");
    } catch {
      if (id !== requestId.current || next.signal.aborted) return;
      setState("error");
    }
  }, []);

  const rate = useCallback(async (rating: ReviewRating) => {
    if (!item || savingRef.current) return;
    savingRef.current = true; setSaving(true); setMessage("Saving review…");
    try {
      await apiRequest(`/api/infographics/${item.id}/reviews`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating }) });
      setMessage("Review saved.");
      // Queue progression starts only after the immutable review event has been confirmed.
      await load();
    } catch { setMessage("The review could not be saved. Try again."); }
    finally { savingRef.current = false; setSaving(false); }
  }, [item, load]);

  useEffect(() => {
    if (deferredAbort.current !== null) { window.clearTimeout(deferredAbort.current); deferredAbort.current = null; }
    if (!initialLoadStarted.current) { initialLoadStarted.current = true; void load(); }
    return () => { deferredAbort.current = window.setTimeout(() => controller.current?.abort(), 0); };
  }, [load]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isShortcutSuppressed(event)) return;
      const rating = ratingFromShortcut(event.key);
      if (!rating || savingRef.current || !item) return;
      event.preventDefault(); void rate(rating);
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [item, rate]);

  return <div className="learning-page review-page"><PageHeader title="Review" /><p aria-live="polite" className={`review-announcement${message.includes("could not") ? " error-copy" : ""}`}>{message}</p>{state === "loading" ? <PageState kind="loading" layout="stage" title={saving ? "Saving review…" : "Loading next review…"} /> : null}{state === "error" ? <PageState action={<RetryButton onRetry={() => void load()} />} kind="error" layout="stage" title="The review could not be loaded. Try again." /> : null}{state === "empty" ? <PageState action={<a className="button button--primary" href={routes.today}>Back to Today</a>} description="No reviews are due right now." kind="empty" layout="stage" title="You are caught up." /> : null}{state === "success" && item ? <section className="review-card learning-stage"><h2>Next review</h2><MediaCanvas className="learning-media" variant="learning"><Image alt={item.title} fill priority sizes="(max-width: 767px) calc(100vw - 40px), min(900px, 70vw)" src={`/api/public/images/${item.originalDriveFileId}`} /></MediaCanvas><h3>{item.title}</h3><p>Do you remember the main idea of this infographic?</p><RatingControls disabled={saving} onRate={rate} /></section> : null}</div>;
}
