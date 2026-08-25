"use client";

import type { AiMetadataSuggestion, Category, InfographicPatch, MaterializedInfographic, Tag } from "@inf/contracts";
import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { ApiClientError, apiRequest, apiRequestForm } from "../../lib/api-client";
import { AiSuggestBanner, type AiRowStatus } from "./ai-suggest-banner";
import { CategoryEditor } from "./category-editor";
import { TagEditor } from "./tag-editor";

interface InboxRowProps {
  item: MaterializedInfographic;
  categories: readonly Category[];
  tags: readonly Tag[];
  aiStatus: AiRowStatus;
  onAiApply: (id: string, suggestion: AiMetadataSuggestion) => void;
  onAiDismiss: (id: string) => void;
  onAiRetry: (id: string) => void;
  onMoved: (next: MaterializedInfographic) => void;
  onUpdated: (next: MaterializedInfographic) => void;
  onDeleted: (id: string) => void;
}

function normalizedName(value: string) { return value.normalize("NFKC").trim().toLocaleLowerCase("en-US"); }
function slugFor(value: string) {
  const slug = normalizedName(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "tag";
}
function createTaxonomy<T extends Category | Tag>(displayName: string, known: readonly T[]): T {
  const normalized = normalizedName(displayName);
  const existing = known.find((candidate) => candidate.normalizedName === normalized);
  if (existing) return existing;
  return { id: crypto.randomUUID(), displayName: displayName.trim(), normalizedName: normalized, slug: slugFor(displayName) } as T;
}

/** Splits comma-delimited tags by canonical identity while retaining the first typed display form. */
export function parseTags(value: string, known: readonly Tag[]): Tag[] {
  const identity = new Set<string>();
  const result: Tag[] = [];
  for (const displayName of value.split(",").map((part) => part.normalize("NFKC").trim()).filter(Boolean)) {
    const normalized = normalizedName(displayName);
    if (identity.has(normalized)) continue;
    identity.add(normalized);
    result.push(createTaxonomy(displayName, known));
  }
  return result;
}

const MAX_IMAGE_BYTES = 20_000_000;
const supportedImageMimes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);

export function InboxRow({ item, categories, tags, aiStatus, onAiApply, onAiDismiss, onAiRetry, onMoved, onUpdated, onDeleted }: InboxRowProps) {
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [sourceUrl, setSourceUrl] = useState(item.sourceUrl ?? "");
  const [sourcePlatform, setSourcePlatform] = useState(item.sourcePlatform ?? "");
  const [sourceAuthor, setSourceAuthor] = useState(item.sourceAuthor ?? "");
  const [category, setCategory] = useState("");
  const [tagText, setTagText] = useState("");
  const [saving, setSaving] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replacingError, setReplacingError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<null | "saved" | "replaced">(null);
  const [error, setError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [thumbnail, setThumbnail] = useState(item.thumbnailDriveFileId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (savedFlash === null) return undefined;
    const timer = setTimeout(() => setSavedFlash(null), 1800);
    return () => clearTimeout(timer);
  }, [savedFlash]);

  function applyAi(suggestion: AiMetadataSuggestion) {
    if (suggestion.title) setTitle(suggestion.title);
    if (suggestion.notes) setNotes(suggestion.notes);
    if (suggestion.sourceUrl) setSourceUrl(suggestion.sourceUrl);
    if (suggestion.sourcePlatform) setSourcePlatform(suggestion.sourcePlatform);
    if (suggestion.sourceAuthor) setSourceAuthor(suggestion.sourceAuthor);
    onAiApply(item.id, suggestion);
  }

  async function apply() {
    if (saving) return;
    const patch: InfographicPatch = {};
    if (title.trim() && title.trim() !== item.title) patch.title = title.trim();
    if (notes.trim() !== (item.notes ?? "")) patch.notes = notes.trim() ? notes.trim() : null;
    if (sourceUrl.trim() !== (item.sourceUrl ?? "")) patch.sourceUrl = sourceUrl.trim() ? sourceUrl.trim() : null;
    if (sourcePlatform.trim() !== (item.sourcePlatform ?? "")) patch.sourcePlatform = sourcePlatform.trim() ? sourcePlatform.trim() : null;
    if (sourceAuthor.trim() !== (item.sourceAuthor ?? "")) patch.sourceAuthor = sourceAuthor.trim() ? sourceAuthor.trim() : null;
    if (category.trim()) patch.categories = [createTaxonomy<Category>(category, categories)];
    if (tagText.trim()) patch.tags = parseTags(tagText, tags);
    if (Object.keys(patch).length === 0) return;
    setSaving(true); setError(false);
    try {
      const response = await apiRequest<{ updated: boolean }>(`/api/infographics/${encodeURIComponent(item.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (!response.updated) { setError(true); setSaving(false); return; }
      setCategory(""); setTagText("");
      if (patch.categories?.length) {
        // Move the row to Library; the next catalog refresh will reflect this.
        onMoved({ ...item, ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.notes !== undefined ? { notes: patch.notes } : {}), ...(patch.sourceUrl !== undefined ? { sourceUrl: patch.sourceUrl } : {}), ...(patch.sourcePlatform !== undefined ? { sourcePlatform: patch.sourcePlatform } : {}), ...(patch.sourceAuthor !== undefined ? { sourceAuthor: patch.sourceAuthor } : {}) });
      } else {
        const next: MaterializedInfographic = { ...item, ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.notes !== undefined ? { notes: patch.notes } : {}), ...(patch.sourceUrl !== undefined ? { sourceUrl: patch.sourceUrl } : {}), ...(patch.sourcePlatform !== undefined ? { sourcePlatform: patch.sourcePlatform } : {}), ...(patch.sourceAuthor !== undefined ? { sourceAuthor: patch.sourceAuthor } : {}) };
        onUpdated(next);
        setSavedFlash("saved");
        setSaving(false);
      }
    } catch { setError(true); setSaving(false); }
  }

  async function replaceImage(file: File) {
    if (replacing) return;
    if (!supportedImageMimes.has(file.type)) { setReplacingError("Choose a PNG, JPEG, WebP, GIF, or AVIF image."); return; }
    if (file.size > MAX_IMAGE_BYTES) { setReplacingError("This image is too large. Choose an image up to 20 MB."); return; }
    setReplacing(true); setReplacingError(null);
    const form = new FormData();
    form.append("file", file, file.name);
    try {
      const next = await apiRequestForm<MaterializedInfographic>(`/api/infographics/${encodeURIComponent(item.id)}/image`, form);
      setThumbnail(next.thumbnailDriveFileId);
      onUpdated(next);
      setSavedFlash("replaced");
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.status === 409) setReplacingError("This image is already in your library.");
      else if (cause instanceof ApiClientError && cause.status === 415) setReplacingError("This image format is not supported for replacement.");
      else if (cause instanceof ApiClientError && cause.status === 413) setReplacingError("This image is too large. Choose an image up to 20 MB.");
      else setReplacingError("The image could not be replaced. Try again.");
    } finally {
      setReplacing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function deleteRow() {
    if (deleting) return;
    setDeleting(true); setError(false);
    try {
      await apiRequest(`/api/infographics/${encodeURIComponent(item.id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
      setConfirmDelete(false);
      onDeleted(item.id);
    } catch { setError(true); setDeleting(false); setConfirmDelete(false); }
  }

  function onFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    void replaceImage(file);
  }

  return <article className="inbox-row" data-id={item.id}>
    <div className="inbox-row__media">
      <img alt={item.title} className="inbox-row__image" key={thumbnail} src={`/api/public/images/${encodeURIComponent(thumbnail)}`} />
      <div className="inbox-row__media-actions">
        <button aria-label="Replace image" className="inbox-row__replace" disabled={replacing} onClick={() => fileInputRef.current?.click()} type="button">
          {replacing ? <LoaderCircle aria-hidden="true" className="is-spinning" size={16} strokeWidth={1.75} /> : <ImagePlus aria-hidden="true" size={16} strokeWidth={1.75} />}
          <span>{replacing ? "Replacing…" : "Replace image"}</span>
        </button>
        <input accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden onChange={onFileSelected} ref={fileInputRef} type="file" />
        {replacingError ? <p aria-live="polite" className="form-message form-message--error" role="status">{replacingError}</p> : null}
        {savedFlash === "replaced" ? <p aria-live="polite" className="form-message form-message--success" role="status">Image replaced.</p> : null}
      </div>
    </div>
    <div className="inbox-row__content">
      <div className="inbox-row__heading"><strong>{item.title}</strong><span>{new Date(item.capturedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></div>
      <AiSuggestBanner onApply={applyAi} onDismiss={() => onAiDismiss(item.id)} onRetry={onAiRetry ? () => onAiRetry(item.id) : undefined} status={aiStatus} />
      <div className="inbox-row__fields">
        <label className="inbox-editor__field">Title<input aria-label="Title" maxLength={200} onChange={(event) => setTitle(event.currentTarget.value)} value={title} /></label>
        <label className="inbox-editor__field">Notes<textarea aria-label="Notes" maxLength={10000} onChange={(event) => setNotes(event.currentTarget.value)} rows={3} value={notes} /></label>
        <label className="inbox-editor__field">Source URL<input aria-label="Source URL" onChange={(event) => setSourceUrl(event.currentTarget.value)} placeholder="https://" type="url" value={sourceUrl} /></label>
        <label className="inbox-editor__field">Platform<input aria-label="Platform" maxLength={100} onChange={(event) => setSourcePlatform(event.currentTarget.value)} value={sourcePlatform} /></label>
        <label className="inbox-editor__field">Source author<input aria-label="Source author" maxLength={200} onChange={(event) => setSourceAuthor(event.currentTarget.value)} value={sourceAuthor} /></label>
        <CategoryEditor categories={categories} onChange={setCategory} value={category} />
        <TagEditor onChange={setTagText} tags={tags} value={tagText} />
      </div>
      {error ? <p aria-live="polite" className="form-message form-message--error" role="status">Changes could not be saved. Try again.</p> : null}
      {savedFlash === "saved" ? <p aria-live="polite" className="form-message form-message--success" role="status">Saved.</p> : null}
      <div className="inbox-row__actions">
        <Button disabled={saving || deleting} onClick={() => void apply()}>{saving ? "Saving to Inbox…" : "Apply"}</Button>
        <Button disabled={saving || deleting} onClick={() => setConfirmDelete(true)} variant="quiet">
          <Trash2 aria-hidden="true" size={16} strokeWidth={1.75} /> Delete
        </Button>
      </div>
    </div>
    {confirmDelete ? <DeleteConfirmDialog busy={deleting} itemTitle={item.title} onCancel={() => setConfirmDelete(false)} onConfirm={() => void deleteRow()} /> : null}
  </article>;
}

interface DeleteConfirmDialogProps { itemTitle: string; busy: boolean; onCancel: () => void; onConfirm: () => void; }
function DeleteConfirmDialog({ itemTitle, busy, onCancel, onConfirm }: DeleteConfirmDialogProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === "Escape" && !busy) onCancel(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);
  return <div className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby={`delete-${itemTitle}`}>
    <div className="delete-dialog__scrim" onClick={busy ? undefined : onCancel} />
    <div className="delete-dialog__panel">
      <h2 id={`delete-${itemTitle}`}>Delete this infographic?</h2>
      <p>This trashes the original and the thumbnail in Drive and removes the row from your Inbox.</p>
      <div className="delete-dialog__actions">
        <button className="button button--secondary" disabled={busy} onClick={onCancel} type="button">Cancel</button>
        <button className="button button--primary" disabled={busy} onClick={onConfirm} type="button">{busy ? "Deleting…" : "Delete"}</button>
      </div>
    </div>
  </div>;
}
