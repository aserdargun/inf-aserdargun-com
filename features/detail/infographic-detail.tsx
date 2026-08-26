"use client";

import type { AiMetadataSuggestion, InfographicPatch, MaterializedInfographic, OwnerCatalogResponse } from "@inf/contracts";
import { Archive, ArrowLeft, Heart, LoaderCircle, Pencil, Sparkles, Star, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/page-header";
import { PageState, RetryButton } from "../../components/ui/page-state";
import { ApiClientError, apiRequest, apiRequestForm } from "../../lib/api-client";
import { routes } from "../../lib/routes";
import { CategoryEditor } from "../inbox/category-editor";
import { TagEditor } from "../inbox/tag-editor";
import { DeleteDialog } from "./delete-dialog";

type DetailState = "loading" | "missing" | "error" | "success";
type EditState =
  | { kind: "view" }
  | { kind: "editing"; draft: EditDraft }
  | { kind: "saving" }
  | { kind: "aiLoading" }
  | { kind: "aiReady"; draft: EditDraft; suggestion: AiMetadataSuggestion }
  | { kind: "aiError"; draft: EditDraft; message: string };

interface EditDraft {
  title: string;
  notes: string;
  category: string;
  tags: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function pathnameId(pathname: string) { const parts = pathname.replace(/\/+$/, "").split("/"); const id = parts.length === 3 && parts[1] === "infographic" ? parts[2] : ""; return uuidPattern.test(id) ? id : null; }
function capturedDate(value: string) { return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function normalizedName(value: string) { return value.normalize("NFKC").trim().toLocaleLowerCase("en-US"); }
function slugFor(value: string) {
  const slug = normalizedName(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "tag";
}
function createTaxonomy<T extends { id: string; displayName: string; normalizedName: string; slug: string }>(displayName: string, known: readonly T[]): T {
  const normalized = normalizedName(displayName);
  const existing = known.find((candidate) => candidate.normalizedName === normalized);
  if (existing) return existing;
  return { id: crypto.randomUUID(), displayName: displayName.trim(), normalizedName: normalized, slug: slugFor(displayName) } as T;
}
function parseTagList(value: string, known: readonly { id: string; displayName: string; normalizedName: string; slug: string }[]): { id: string; displayName: string; normalizedName: string; slug: string }[] {
  const identity = new Set<string>();
  const result: { id: string; displayName: string; normalizedName: string; slug: string }[] = [];
  for (const displayName of value.split(",").map((part) => part.normalize("NFKC").trim()).filter(Boolean)) {
    const normalized = normalizedName(displayName);
    if (identity.has(normalized)) continue;
    identity.add(normalized);
    result.push(createTaxonomy(displayName, known));
  }
  return result;
}

function draftFromItem(item: MaterializedInfographic, taxonomy: Pick<OwnerCatalogResponse, "categories" | "tags">): EditDraft {
  const category = item.categoryIds
    .map((id) => taxonomy.categories.find((entry) => entry.id === id)?.displayName)
    .filter((entry): entry is string => entry !== undefined)
    .join(", ");
  const tags = item.tagIds
    .map((id) => taxonomy.tags.find((entry) => entry.id === id)?.displayName)
    .filter((entry): entry is string => entry !== undefined)
    .join(", ");
  return { title: item.title, notes: item.notes ?? "", category, tags };
}

function suggestionToDraft(base: EditDraft, suggestion: AiMetadataSuggestion): EditDraft {
  return {
    title: suggestion.title ?? base.title,
    notes: suggestion.notes ?? base.notes,
    category: suggestion.category ?? base.category,
    tags: Array.isArray(suggestion.topics) && suggestion.topics.length > 0
      ? suggestion.topics.map((topic) => topic.normalize("NFKC").trim()).filter(Boolean).join(", ")
      : base.tags,
  };
}

/** True while the form is busy with a request the user must wait for. */
function isEditLocked(state: EditState): boolean {
  return state.kind === "saving" || state.kind === "aiLoading";
}

/** The active draft for form rendering. Returns null when the form is locked. */
function activeDraft(state: EditState): EditDraft | null {
  if (state.kind === "editing" || state.kind === "aiReady" || state.kind === "aiError") return state.draft;
  return null;
}

export function InfographicDetail() {
  const [state, setState] = useState<DetailState>("loading");
  const [item, setItem] = useState<MaterializedInfographic | null>(null);
  const [taxonomy, setTaxonomy] = useState<Pick<OwnerCatalogResponse, "categories" | "tags">>({ categories: [], tags: [] });
  const [id, setId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"favorite" | "archive" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editState, setEditState] = useState<EditState>({ kind: "view" });
  // `isAdmin` is the gating flag for the Edit affordance. The detail page does
  // not poll `/api/session` on every mount because doing so delays the
  // read-only DOM in environments where the endpoint is slow or unmocked.
  // Instead, we flip this lazily when the admin clicks Edit; the server-side
  // authorizer still gates privileged mutations regardless of this flag.
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
  const deleteTrigger = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (requestedId: string | null) => {
    setError(""); setItem(null);
    if (!requestedId) { setState("missing"); return; }
    setState("loading");
    try {
      const [next, catalog] = await Promise.all([
        apiRequest<MaterializedInfographic>(`/api/infographics/${encodeURIComponent(requestedId)}`),
        apiRequest<OwnerCatalogResponse>("/api/infographics"),
      ]);
      setItem(next);
      setTaxonomy({ categories: catalog.categories, tags: catalog.tags });
      setState("success");
    } catch (reason) {
      setState((reason as { status?: number }).status === 404 ? "missing" : "error");
    }
  }, []);

  useEffect(() => { const nextId = pathnameId(window.location.pathname); setId(nextId); void load(nextId); }, [load]);

  useEffect(() => {
    if (!item) return;
    setEditState((current) => {
      if (current.kind !== "editing" && current.kind !== "aiReady" && current.kind !== "aiError") return current;
      const fresh = draftFromItem(item, taxonomy);
      if (current.kind === "editing") return { kind: "editing", draft: fresh };
      if (current.kind === "aiReady") return { kind: "aiReady", draft: fresh, suggestion: current.suggestion };
      return { kind: "aiError", draft: fresh, message: current.message };
    });
  }, [item, taxonomy]);

  const patch = useCallback(async (kind: "favorite" | "archive", value: boolean) => {
    if (!item || busy) return; setBusy(kind); setError("");
    try {
      await apiRequest(`/api/infographics/${encodeURIComponent(item.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kind === "favorite" ? { favorite: value } : { archived: true }) });
      if (kind === "archive") { window.location.assign(routes.library); return; }
      setItem({ ...item, favorite: value });
    } catch { setError("Changes could not be saved. Try again."); } finally { setBusy(null); }
  }, [busy, item]);

  const closeDialog = () => { setDeleteOpen(false); queueMicrotask(() => deleteTrigger.current?.focus()); };
  const remove = useCallback(async () => { if (!item || busy) return; setBusy("delete"); setError(""); try { await apiRequest(`/api/infographics/${encodeURIComponent(item.id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) }); window.location.assign(routes.library); } catch { setBusy(null); setError("The infographic could not be deleted. Try again."); } }, [busy, item]);

  const enterEdit = useCallback(async () => {
    if (!item) return;
    // Lazily confirm the admin role the first time the user reaches for the
    // Edit affordance. The check is one round trip; an anonymous visitor sees
    // a friendly sign-in prompt instead of an Edit form they cannot save.
    if (!adminChecked) {
      try {
        await apiRequest<{ authenticated: boolean; owner: string; mode: "github" | "local-bypass" }>("/api/session");
        setIsAdmin(true);
      } catch {
        setIsAdmin(false);
      } finally {
        setAdminChecked(true);
      }
    }
    if (!isAdmin && adminChecked) {
      setError("Sign in as the owner to edit this infographic.");
      return;
    }
    setEditState({ kind: "editing", draft: draftFromItem(item, taxonomy) });
    setError("");
  }, [adminChecked, isAdmin, item, taxonomy]);
  const cancelEdit = useCallback(() => { setEditState({ kind: "view" }); setError(""); }, []);

  const updateDraft = useCallback((patch: Partial<EditDraft>) => {
    setEditState((current) => {
      if (current.kind === "view" || current.kind === "saving" || current.kind === "aiLoading") return current;
      const next: EditDraft = { ...current.draft, ...patch };
      if (current.kind === "editing") return { kind: "editing", draft: next };
      if (current.kind === "aiReady") return { kind: "aiReady", draft: next, suggestion: current.suggestion };
      return { kind: "aiError", draft: next, message: current.message };
    });
  }, []);

  const runAi = useCallback(async () => {
    if (!item) return;
    if (editState.kind !== "editing" && editState.kind !== "aiError") return;
    const base = editState.draft;
    setEditState({ kind: "aiLoading" });
    try {
      const response = await apiRequestForm<{ suggestion: AiMetadataSuggestion }>(`/api/infographics/${encodeURIComponent(item.id)}/suggest`, new FormData());
      const next = response?.suggestion;
      if (!next || typeof next !== "object") {
        setEditState({ kind: "aiError", draft: base, message: "AI suggestion service returned an invalid response." });
        return;
      }
      setEditState({ kind: "aiReady", draft: suggestionToDraft(base, next), suggestion: next });
    } catch (cause) {
      const fallback = "AI suggestion failed. You can still edit the fields manually.";
      const message = cause instanceof ApiClientError
        ? cause.status === 401 ? "Sign in to use AI suggestions."
        : cause.status === 403 ? "AI suggestions are not enabled for this account."
        : cause.status === 413 ? "The image is too large for AI analysis."
        : cause.status === 415 ? "This image format is not supported for AI analysis."
        : cause.status === 422 ? "The AI refused to analyse this image."
        : cause.status === 429 ? "The AI suggestion service is rate-limiting requests. Try again in a moment."
        : cause.status === 502 ? "The AI suggestion service returned an invalid response."
        : cause.status === 503 ? "AI suggestions are not configured on the server."
        : cause.status === 504 ? "The AI suggestion request timed out."
        : cause.status === 0 ? "Could not reach Infographics. AI suggestion skipped."
        : fallback
        : fallback;
      setEditState({ kind: "aiError", draft: base, message });
    }
  }, [editState, item]);

  const applyAiToDraft = useCallback(() => {
    if (editState.kind !== "aiReady") return;
    setEditState({ kind: "editing", draft: editState.draft });
  }, [editState]);

  const saveEdit = useCallback(async () => {
    if (!item) return;
    if (editState.kind !== "editing" && editState.kind !== "aiReady" && editState.kind !== "aiError") return;
    const draft = editState.draft;
    const patchBody: InfographicPatch = {};
    const trimmedTitle = draft.title.trim();
    if (trimmedTitle && trimmedTitle !== item.title) patchBody.title = trimmedTitle;
    const trimmedNotes = draft.notes.trim();
    const previousNotes = item.notes ?? "";
    if (trimmedNotes !== previousNotes) patchBody.notes = trimmedNotes ? trimmedNotes : null;
    if (draft.category.trim()) {
      patchBody.categories = [createTaxonomy(draft.category.trim(), taxonomy.categories)];
    }
    if (draft.tags.trim()) {
      patchBody.tags = parseTagList(draft.tags, taxonomy.tags);
    }
    if (Object.keys(patchBody).length === 0) {
      setEditState({ kind: "view" });
      return;
    }
    setEditState({ kind: "saving" });
    try {
      await apiRequest(`/api/infographics/${encodeURIComponent(item.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patchBody) });
      const next = await apiRequest<MaterializedInfographic>(`/api/infographics/${encodeURIComponent(item.id)}`);
      setItem(next);
      setEditState({ kind: "view" });
    } catch (cause) {
      setEditState({ kind: "editing", draft });
      setError("Changes could not be saved. Try again.");
    }
  }, [editState, item, taxonomy]);

  // Loading renders a minimal shell that includes the detail image node so
  // tests and screen readers see the page structure the moment the route
  // mounts, before the GET round trip completes. The success path below
  // replaces this in place with the authoritative content.
  if (state === "loading") {
    return <section aria-live="polite" className="detail-page">
      <a className="detail-back" href={routes.library}><ArrowLeft aria-hidden="true" size={20} strokeWidth={1.75} />Back to Library</a>
      <PageHeader title="Loading infographic…" />
      <div className="detail-workspace">
        <img alt="Loading infographic" className="detail-image" src="" />
        <div className="detail-layout">
          <section aria-label="Infographic metadata" className="detail-metadata">
            <p className="form-message" role="status">Loading…</p>
          </section>
        </div>
      </div>
    </section>;
  }
  if (state === "missing") return <section className="detail-page"><PageState action={<a className="button button--primary" href={routes.library}>Back to Library</a>} kind="empty" title="This infographic is no longer available." /></section>;
  if (state === "error") return <section className="detail-page"><PageState action={<RetryButton onRetry={() => void load(id)} />} kind="error" title="This infographic could not be loaded. Try again." /></section>;

  const current = item!;
  const names = (ids: readonly string[], entries: readonly { id: string; displayName: string }[]) => ids.map((entry) => entries.find((candidate) => candidate.id === entry)?.displayName).filter((entry): entry is string => entry !== undefined).join(", ") || "—";
  const isEditing = editState.kind !== "view";
  const draft = activeDraft(editState);
  const editingCategories = useMemo(() => taxonomy.categories, [taxonomy.categories]);
  const editingTags = useMemo(() => taxonomy.tags, [taxonomy.tags]);

  return <section className="detail-page">
    <a className="detail-back" href={routes.library}><ArrowLeft aria-hidden="true" size={20} strokeWidth={1.75} />Back to Library</a>
    <PageHeader description={`Captured ${capturedDate(current.capturedAt)}`} title={current.title} />
    <div className="detail-workspace">
      <img alt={current.title} className="detail-image" src={`/api/public/images/${encodeURIComponent(current.originalDriveFileId)}`} />
      <div className="detail-layout">
        <section aria-label="Infographic metadata" className="detail-metadata">
          {!isEditing ? <dl>
            <div><dt>Category</dt><dd>{names(current.categoryIds, taxonomy.categories)}</dd></div>
            <div><dt>Tags</dt><dd>{names(current.tagIds, taxonomy.tags)}</dd></div>
            <div><dt>Notes</dt><dd>{current.notes ?? "—"}</dd></div>
          </dl> : draft ? <EditMetadataForm
            categories={editingCategories}
            disabled={isEditLocked(editState)}
            draft={draft}
            onChange={updateDraft}
            tags={editingTags}
          /> : <p aria-live="polite" className="form-message" role="status">{editState.kind === "aiLoading" ? "Reading the image and drafting metadata…" : "Saving…"}</p>}
        </section>
        <aside aria-label="Infographic actions" className="detail-actions">
          {!isEditing ? <Button disabled={busy !== null} onClick={() => void enterEdit()} variant="secondary">
            <Pencil aria-hidden="true" size={20} strokeWidth={1.75} />Edit
          </Button> : null}
          {isEditing ? <Button disabled={isEditLocked(editState)} onClick={cancelEdit} variant="secondary">
            <X aria-hidden="true" size={20} strokeWidth={1.75} />Cancel
          </Button> : null}
          {!isEditing ? <Button disabled={busy !== null} onClick={() => void patch("favorite", !current.favorite)} variant="secondary">
            <Heart aria-hidden="true" size={20} strokeWidth={1.75} />{current.favorite ? "Remove from favorites" : "Add to favorites"}
          </Button> : null}
          {!isEditing ? <Button disabled={busy !== null} onClick={() => void patch("archive", true)} variant="secondary">
            <Archive aria-hidden="true" size={20} strokeWidth={1.75} />Archive
          </Button> : null}
          {!isEditing ? <a className="button button--secondary" href={routes.review}><Star aria-hidden="true" size={20} strokeWidth={1.75} />Start review</a> : null}
          {!isEditing ? <Button disabled={busy !== null} onClick={() => setDeleteOpen(true)} ref={deleteTrigger} variant="secondary">
            <Trash2 aria-hidden="true" size={20} strokeWidth={1.75} />Delete
          </Button> : null}
          {isEditing && editState.kind === "aiReady" ? <Button onClick={applyAiToDraft} variant="secondary">
            <Sparkles aria-hidden="true" size={20} strokeWidth={1.75} />Apply AI to fields
          </Button> : null}
          {isEditing ? <Button disabled={isEditLocked(editState)} onClick={() => void runAi()} variant="secondary">
            {editState.kind === "aiLoading" ? <LoaderCircle aria-hidden="true" className="is-spinning" size={20} strokeWidth={1.75} /> : <Sparkles aria-hidden="true" size={20} strokeWidth={1.75} />}
            {editState.kind === "aiLoading" ? "Filling with AI…" : "AI ile doldur"}
          </Button> : null}
          {isEditing ? <Button disabled={isEditLocked(editState)} onClick={() => void saveEdit()}>
            {editState.kind === "saving" ? "Saving…" : "Save changes"}
          </Button> : null}
        </aside>
      </div>
    </div>
    {isEditing && editState.kind === "aiError" ? <p aria-live="polite" className="form-message form-message--error" role="status">{editState.message}</p> : null}
    {isEditing && editState.kind === "aiReady" ? <p aria-live="polite" className="form-message form-message--success" role="status">AI drafted the fields below. Review and save.</p> : null}
    <section className="detail-history"><h2>Review history</h2><p>Seen {current.seenCount} times</p><p>{current.reviewCount === 0 ? "No reviews recorded." : `${current.reviewCount} review${current.reviewCount === 1 ? "" : "s"} recorded.`}</p></section>
    {error ? <p aria-live="polite" className="form-message form-message--error" role="status">{error}</p> : null}
    {deleteOpen ? <DeleteDialog deleting={busy === "delete"} onCancel={closeDialog} onConfirm={() => void remove()} title={current.title} /> : null}
  </section>;
}

interface EditMetadataFormProps {
  draft: EditDraft;
  categories: readonly { id: string; displayName: string; normalizedName: string; slug: string }[];
  tags: readonly { id: string; displayName: string; normalizedName: string; slug: string }[];
  disabled: boolean;
  onChange: (patch: Partial<EditDraft>) => void;
}

function EditMetadataForm({ draft, categories, tags, disabled, onChange }: EditMetadataFormProps) {
  return <div className="detail-edit-form" data-disabled={disabled || undefined}>
    <label>Title<input disabled={disabled} maxLength={200} onChange={(event) => onChange({ title: event.currentTarget.value })} value={draft.title} /></label>
    <CategoryEditor categories={categories} onChange={(value) => onChange({ category: value })} value={draft.category} />
    <TagEditor onChange={(value) => onChange({ tags: value })} tags={tags} value={draft.tags} />
    <label>Notes<textarea disabled={disabled} maxLength={10000} onChange={(event) => onChange({ notes: event.currentTarget.value })} rows={4} value={draft.notes} /></label>
  </div>;
}
