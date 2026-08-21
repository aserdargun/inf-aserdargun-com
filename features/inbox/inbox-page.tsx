"use client";

import type { OwnerCatalogResponse } from "@inf/contracts";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { PageState, RetryButton } from "../../components/ui/page-state";
import { apiRequest } from "../../lib/api-client";
import { routes } from "../../lib/routes";
import { InboxRow } from "./inbox-row";

type InboxState = "loading" | "empty" | "error" | "success";

export function InboxPage() {
  const [state, setState] = useState<InboxState>("loading");
  const [catalog, setCatalog] = useState<OwnerCatalogResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [moved, setMoved] = useState(false);
  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await apiRequest<OwnerCatalogResponse>("/api/infographics");
      const inbox = response.infographics.filter((item) => item.folderState === "Inbox" && !item.archived);
      setCatalog({ ...response, infographics: inbox });
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
  const syncButton = <Button disabled={syncing} onClick={() => void sync()} variant="secondary"><RefreshCw aria-hidden="true" className={syncing ? "is-spinning" : ""} size={20} strokeWidth={1.75} />{syncing ? "Syncing Drive…" : "Sync Drive"}</Button>;
  const heading = <header className="inbox-page__header"><div><h1>Inbox</h1><p>Captured infographics waiting to be organized.</p></div>{syncButton}</header>;
  if (state === "loading") return <section className="inbox-page">{heading}<PageState kind="loading" title="Loading Inbox…" /></section>;
  if (state === "error") return <section className="inbox-page">{heading}<PageState action={<RetryButton onRetry={() => void load()} />} kind="error" title="Inbox could not be loaded. Try again." /></section>;
  if (state === "empty") return <section className="inbox-page">{heading}{syncing ? <p className="form-message" role="status">Syncing Drive…</p> : null}{syncError ? <p className="form-message form-message--error" role="status">Drive could not be synced. Try again.</p> : null}{moved ? <p className="form-message form-message--success" role="status">Moved to Library</p> : null}<PageState action={<a className="button button--primary" href={routes.add}>Add infographic</a>} description="Paste an image or sync Drive to begin." kind="empty" title="Inbox is empty." /></section>;
  return <section className="inbox-page">{heading}{syncing ? <p className="form-message" role="status">Syncing Drive…</p> : null}{syncError ? <p className="form-message form-message--error" role="status">Drive could not be synced. Try again.</p> : null}{moved ? <p className="form-message form-message--success" role="status">Moved to Library</p> : null}<div className="inbox-list">{catalog!.infographics.map((item) => <InboxRow categories={catalog!.categories} item={item} key={item.id} onMoved={() => { setMoved(true); setCatalog((current) => current ? { ...current, infographics: current.infographics.filter((candidate) => candidate.id !== item.id) } : current); setState(catalog!.infographics.length === 1 ? "empty" : "success"); }} tags={catalog!.tags} />)}</div></section>;
}
