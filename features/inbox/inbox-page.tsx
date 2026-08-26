"use client";

import type { AiMetadataSuggestion, MaterializedInfographic, OwnerCatalogResponse } from "@inf/contracts";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/page-header";
import { PageState, RetryButton } from "../../components/ui/page-state";
import { ApiClientError, apiRequest, apiRequestForm } from "../../lib/api-client";
import { routes } from "../../lib/routes";
import type { AiRowStatus } from "./ai-suggest-banner";
import { runWithConcurrency } from "./ai-trigger";
import { InboxRow } from "./inbox-row";

type InboxState = "loading" | "empty" | "error" | "success";
type AiState = Record<string, AiRowStatus>;

interface AiErrorMap { [id: string]: string; }

const AI_CONCURRENCY = 3;

function aiErrorMessage(status: number, fallback: string): string {
  if (status === 401) return "Sign in to use AI suggestions.";
  if (status === 403) return "AI suggestions are not enabled for this account.";
  if (status === 413) return "The image is too large for AI analysis.";
  if (status === 415) return "This image format is not supported for AI analysis.";
  if (status === 422) return "The AI refused to analyse this image.";
  if (status === 429) return "The AI suggestion service is rate-limiting requests. Try again in a moment.";
  if (status === 502) return "The AI suggestion service returned an invalid response.";
  if (status === 503) return "AI suggestions are not configured on the server.";
  if (status === 504) return "The AI suggestion request timed out.";
  if (status === 0) return "Could not reach Infographics. AI suggestion skipped.";
  return fallback;
}

export function InboxPage() {
  const [state, setState] = useState<InboxState>("loading");
  const [catalog, setCatalog] = useState<OwnerCatalogResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [moved, setMoved] = useState(false);
  const [aiStates, setAiStates] = useState<AiState>({});
  const [aiErrors, setAiErrors] = useState<AiErrorMap>({});
  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await apiRequest<OwnerCatalogResponse>("/api/infographics");
      // New uploads land directly in Library; the Inbox view is now the
      // backlog of items that still need a category to anchor the learning
      // journey. The server still returns every non-deleted item; we keep
      // this filter client-side so an empty uncategorized list is still a
      // success state rather than an error.
      const inbox = response.infographics.filter((item) => !item.archived && item.categoryIds.length === 0);
      setCatalog({ ...response, infographics: inbox });
      setAiStates({});
      setAiErrors({});
      setState(inbox.length === 0 ? "empty" : "success");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const sync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true); setSyncError(false);
    try { await apiRequest("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); await load(); }
    catch { setSyncError(true); }
    finally { setSyncing(false); }
  }, [load, syncing]);

  const triggerAiFor = useCallback(async (items: readonly MaterializedInfographic[], force: boolean, autoApply: boolean) => {
    if (items.length === 0) return;
    // We only request each item once per page load. The page-wide state reset
    // happens inside `load()`. Per-row retries are tracked explicitly via the
    // `force` flag (e.g. when the user clicks "Try again" on an error banner).
    // `autoApply` is set when the user explicitly asked for a one-click fill
    // (e.g. "AI ile doldur"), so the row applies the values as soon as the
    // suggestion arrives without requiring a separate "Apply AI" confirmation.
    const pending = items.filter((item) => force || true);
    if (pending.length === 0) return;
    setAiStates((state) => {
      const next: AiState = { ...state };
      for (const item of pending) {
        if (force || !next[item.id] || next[item.id]?.kind === "idle") next[item.id] = { kind: "loading", autoApply };
      }
      return next;
    });
    await runWithConcurrency(pending, AI_CONCURRENCY, async (item) => {
      try {
        const response = await apiRequestForm<{ suggestion: AiMetadataSuggestion }>(`/api/infographics/${encodeURIComponent(item.id)}/suggest`, new FormData());
        if (!response || !response.suggestion || typeof response.suggestion !== "object") {
          setAiStates((state) => ({ ...state, [item.id]: { kind: "error", message: "AI suggestion service returned an invalid response." } }));
          setAiErrors((errors) => ({ ...errors, [item.id]: "AI suggestion service returned an invalid response." }));
          return;
        }
        setAiStates((state) => ({ ...state, [item.id]: { kind: "ready", suggestion: response.suggestion, autoApply } }));
      } catch (cause) {
        const message = cause instanceof ApiClientError ? aiErrorMessage(cause.status, "AI suggestion failed. You can still fill the fields manually.") : "AI suggestion failed. You can still fill the fields manually.";
        setAiStates((state) => ({ ...state, [item.id]: { kind: "error", message } }));
        setAiErrors((errors) => ({ ...errors, [item.id]: message }));
      }
    }, () => undefined);
  }, []);

  useEffect(() => {
    if (state !== "success" || !catalog) return;
    void triggerAiFor(catalog.infographics, false, false);
  }, [state, catalog, triggerAiFor]);

  const onAiApply = useCallback((id: string, _suggestion: AiMetadataSuggestion) => {
    setAiStates((state) => { const next = { ...state }; delete next[id]; return next; });
  }, []);
  const onAiDismiss = useCallback((id: string) => {
    setAiStates((state) => { const next = { ...state }; delete next[id]; return next; });
  }, []);
  const onAiRetry = useCallback((id: string) => {
    const item = catalog?.infographics.find((candidate) => candidate.id === id);
    if (!item) return;
    void triggerAiFor([item], true, false);
  }, [catalog, triggerAiFor]);
  const onAiTrigger = useCallback((id: string) => {
    const item = catalog?.infographics.find((candidate) => candidate.id === id);
    if (!item) return;
    // "AI ile doldur" is a one-click intent: the row should auto-apply the
    // suggestion as soon as it arrives, without waiting for an "Apply AI" tap.
    void triggerAiFor([item], true, true);
  }, [catalog, triggerAiFor]);

  const onMoved = useCallback((next: MaterializedInfographic) => {
    setMoved(true);
    setCatalog((current) => current ? { ...current, infographics: current.infographics.filter((candidate) => candidate.id !== next.id) } : current);
    setState((current) => (current === "success" && catalog && catalog.infographics.length === 1 ? "empty" : current));
    setAiStates((state) => { const updated = { ...state }; delete updated[next.id]; return updated; });
  }, [catalog]);
  const onUpdated = useCallback((next: MaterializedInfographic) => {
    setCatalog((current) => current ? { ...current, infographics: current.infographics.map((item) => item.id === next.id ? next : item) } : current);
  }, []);
  const onDeleted = useCallback((id: string) => {
    setCatalog((current) => current ? { ...current, infographics: current.infographics.filter((candidate) => candidate.id !== id) } : current);
    setAiStates((state) => { const next = { ...state }; delete next[id]; return next; });
    setState((current) => {
      if (current !== "success") return current;
      return catalog && catalog.infographics.length === 1 ? "empty" : current;
    });
  }, [catalog]);

  const syncButton = <Button disabled={syncing} onClick={() => void sync()} variant="secondary"><RefreshCw aria-hidden="true" className={syncing ? "is-spinning" : ""} size={20} strokeWidth={1.75} />{syncing ? "Syncing Drive…" : "Sync Drive"}</Button>;
  const heading = <PageHeader actions={syncButton} description="Uncategorized items. Assign a category to anchor them in your Library." title="Inbox" />;
  const aiErrorList = useMemo(() => Object.entries(aiErrors), [aiErrors]);

  if (state === "loading") return <section className="inbox-page">{heading}<PageState kind="loading" title="Loading Inbox…" /></section>;
  if (state === "error") return <section className="inbox-page">{heading}<PageState action={<RetryButton onRetry={() => void load()} />} kind="error" title="Inbox could not be loaded. Try again." /></section>;
  if (state === "empty") return <section className="inbox-page">{heading}{syncing ? <p className="form-message" role="status">Syncing Drive…</p> : null}{syncError ? <p className="form-message form-message--error" role="status">Drive could not be synced. Try again.</p> : null}{moved ? <p className="form-message form-message--success" role="status">Moved to Library</p> : null}<PageState action={<a className="button button--primary" href={routes.add}>Add infographic</a>} description="Paste an image or sync Drive to begin." kind="empty" title="Inbox is empty." /></section>;
  return <section className="inbox-page">{heading}{syncing ? <p className="form-message" role="status">Syncing Drive…</p> : null}{syncError ? <p className="form-message form-message--error" role="status">Drive could not be synced. Try again.</p> : null}{moved ? <p className="form-message form-message--success" role="status">Moved to Library</p> : null}
    {aiErrorList.length === 0 ? null : <p className="form-message" role="status">AI suggestions could not be generated for {aiErrorList.length} item{aiErrorList.length === 1 ? "" : "s"}.</p>}
    <div className="inbox-list">{catalog!.infographics.map((item) => <InboxRow aiStatus={aiStates[item.id] ?? { kind: "idle" }} categories={catalog!.categories} item={item} key={item.id} onAiApply={onAiApply} onAiDismiss={onAiDismiss} onAiRetry={onAiRetry} onAiTrigger={onAiTrigger} onDeleted={onDeleted} onMoved={onMoved} onUpdated={onUpdated} tags={catalog!.tags} />)}</div>
  </section>;
}
