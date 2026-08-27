"use client";

import { Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/page-header";
import { ApiClientError, apiRequest } from "../../lib/api-client";
import { routes } from "../../lib/routes";
import { CaptureDropzone } from "./capture-dropzone";
import { useClipboardImage } from "./use-clipboard-image";

const MAX_IMAGE_BYTES = 20_000_000;
const supportedImageMimes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);
type CaptureError =
  | "Choose an image file."
  | "This image is too large. Choose an image up to 20 MB."
  | "This image could not be used. Choose a different image."
  | "The infographic could not be saved. Try again."
  | "The AI-filled fields could not be saved. The image was added, but category and tags were not."
  | "The AI service could not suggest a category. Type one manually, then save to Library.";

interface ApiErrorMessage { kind: "api"; message: string; }

interface AiSuggestion {
  title: string | null;
  notes: string | null;
  language: string | null;
  category: string | null;
  topics: string[];
  rationale: string | null;
  confidence: number;
}

type AiStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; suggestion: AiSuggestion }
  | { kind: "error"; message: string };

const fieldKeys = ["title", "notes", "category", "tags"] as const;
type FieldKey = (typeof fieldKeys)[number];
type SubmitTarget = "inbox" | "library";

interface CaptureResponse { kind: "created" | "duplicate"; infographicId?: string; title?: string; }

function normalizedName(value: string) { return value.normalize("NFKC").trim().toLocaleLowerCase("en-US"); }
function slugFor(value: string) {
  const slug = normalizedName(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "tag";
}
function createTag(displayName: string, known: readonly { displayName: string; normalizedName: string }[]): { id: string; displayName: string; normalizedName: string; slug: string } {
  const normalized = normalizedName(displayName);
  const existing = known.find((candidate) => candidate.normalizedName === normalized);
  if (existing) return { id: "existing", displayName: existing.displayName, normalizedName: existing.normalizedName, slug: slugFor(existing.displayName) };
  return { id: crypto.randomUUID(), displayName: displayName.trim(), normalizedName: normalized, slug: slugFor(displayName) };
}
function parseTagList(value: string, known: readonly { displayName: string; normalizedName: string }[]): { id: string; displayName: string; normalizedName: string; slug: string }[] {
  const identity = new Set<string>();
  const result: { id: string; displayName: string; normalizedName: string; slug: string }[] = [];
  for (const displayName of value.split(",").map((part) => part.normalize("NFKC").trim()).filter(Boolean)) {
    const normalized = normalizedName(displayName);
    if (identity.has(normalized)) continue;
    identity.add(normalized);
    result.push(createTag(displayName, known));
  }
  return result;
}

export function CaptureForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const currentUrl = useRef<string | null>(null);
  const isSubmitting = useRef(false);
  const requestToken = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<CaptureError | ApiErrorMessage | null>(null);
  const [saving, setSaving] = useState(false);
  const [target, setTarget] = useState<SubmitTarget | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ kind: "idle" });
  const [knownCategories, setKnownCategories] = useState<readonly { displayName: string; normalizedName: string }[]>([]);
  const [knownTags, setKnownTags] = useState<readonly { displayName: string; normalizedName: string }[]>([]);
  // Tracks an in-flight AI run that was started by "Save to Library" because
  // the user had not waited for the auto-suggestion banner to settle. The
  // submit effect below consumes the resolved value before issuing the create.
  const pendingLibraryRef = useRef<{ resolve: () => void; reject: (reason?: unknown) => void } | null>(null);

  const setFieldValue = useCallback((name: FieldKey, value: string) => {
    const form = formRef.current;
    if (!form) return;
    const field = form.elements.namedItem(name);
    if (field && "value" in field) (field as unknown as HTMLInputElement | HTMLTextAreaElement).value = value;
  }, []);

  const clearSuggestion = useCallback(() => {
    setAiStatus({ kind: "idle" });
    for (const key of fieldKeys) setFieldValue(key, "");
  }, [setFieldValue]);

  const requestSuggestion = useCallback(async (nextFile: File) => {
    const token = ++requestToken.current;
    setAiStatus({ kind: "loading" });
    const form = new FormData();
    form.append("file", nextFile, nextFile.name);
    try {
      const data = await apiRequest<{ suggestion: AiSuggestion }>("/api/infographics/suggest-metadata", { method: "POST", body: form });
      if (token !== requestToken.current) return;
      const { suggestion } = data;
      const applied: FieldKey[] = [];
      if (suggestion.title) { setFieldValue("title", suggestion.title); applied.push("title"); }
      if (suggestion.notes) { setFieldValue("notes", suggestion.notes); applied.push("notes"); }
      if (suggestion.category) { setFieldValue("category", suggestion.category); applied.push("category"); }
      if (Array.isArray(suggestion.topics) && suggestion.topics.length > 0) {
        const topicText = suggestion.topics.map((topic) => topic.normalize("NFKC").trim()).filter(Boolean).join(", ");
        if (topicText) { setFieldValue("tags", topicText); applied.push("tags"); }
      }
      try {
        const catalog = await apiRequest<{ categories: { displayName: string; normalizedName: string }[]; tags: { displayName: string; normalizedName: string }[] }>("/api/infographics");
        if (token !== requestToken.current) return;
        setKnownCategories(catalog.categories.map((entry) => ({ displayName: entry.displayName, normalizedName: entry.normalizedName })));
        setKnownTags(catalog.tags.map((entry) => ({ displayName: entry.displayName, normalizedName: entry.normalizedName })));
      } catch { /* catalog is a best-effort hint; do not block the AI banner. */ }
      if (applied.length === 0) {
        setAiStatus({ kind: "error", message: "The image was analysed but no fields could be suggested. You can still fill them manually." });
      } else {
        setAiStatus({ kind: "ready", suggestion: { ...suggestion, topics: suggestion.topics ?? [] } });
      }
    } catch (cause) {
      if (token !== requestToken.current) return;
      const message = cause instanceof ApiClientError
        ? cause.status === 401 ? "Sign in to use AI suggestions."
        : cause.status === 403 ? "AI suggestions are not enabled for this account."
        : cause.status === 413 ? "The image is too large for AI analysis (8 MB cap)."
        : cause.status === 415 ? "This image format is not supported for AI analysis."
        : cause.status === 422 ? "The AI refused to analyse this image."
        : cause.status === 429 ? "The AI suggestion service is rate-limiting requests. Try again in a moment."
        : cause.status === 503 ? "AI suggestions are not configured on the server."
        : cause.status === 0 ? "Could not reach Infographics. AI suggestion skipped."
        : "AI suggestion failed. You can still fill the fields manually."
        : "AI suggestion failed. You can still fill the fields manually.";
      setAiStatus({ kind: "error", message });
    }
  }, [setFieldValue]);

  const selectFile = useCallback((nextFile: File) => {
    if (!supportedImageMimes.has(nextFile.type)) { setError("Choose an image file."); return; }
    if (nextFile.size > MAX_IMAGE_BYTES) { setError("This image is too large. Choose an image up to 20 MB."); return; }
    const nextUrl = URL.createObjectURL(nextFile);
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = nextUrl;
    setFile(nextFile);
    setPreviewUrl(nextUrl);
    setError(null);
    for (const key of fieldKeys) setFieldValue(key, "");
    void requestSuggestion(nextFile);
  }, [requestSuggestion, setFieldValue]);
  useEffect(() => () => { if (currentUrl.current) URL.revokeObjectURL(currentUrl.current); }, []);
  const rejectClipboard = useCallback(() => setError("Choose an image file."), []);
  const chooseClipboard = useClipboardImage({ onImage: selectFile, onReject: rejectClipboard });

  const retryAi = useCallback(() => { if (file && !saving) void requestSuggestion(file); }, [file, requestSuggestion, saving]);

  // "Save to Library" depends on the AI suggestion being applied (or a manually
  // typed category). If the user has not yet waited for the auto-suggestion
  // banner, the submit kicks off a one-shot AI run and waits for it before
  // issuing the create call. Manual categories are always respected.
  const ensureAiForLibrary = useCallback(async (): Promise<{ category: string; tags: string } | null> => {
    if (!file) return null;
    const form = formRef.current;
    const categoryInput = form?.elements.namedItem("category") as HTMLInputElement | null;
    const tagsInput = form?.elements.namedItem("tags") as HTMLInputElement | null;
    const typedCategory = categoryInput?.value.trim() ?? "";
    if (typedCategory) return { category: typedCategory, tags: tagsInput?.value.trim() ?? "" };
    if (aiStatus.kind === "ready" && aiStatus.suggestion.category) return { category: aiStatus.suggestion.category, tags: tagsInput?.value.trim() ?? "" };
    const inflight = new Promise<void>((resolve, reject) => { pendingLibraryRef.current = { resolve, reject }; });
    void requestSuggestion(file);
    try { await inflight; }
    catch { return null; }
    if (aiStatus.kind === "ready" && aiStatus.suggestion.category) {
      return { category: aiStatus.suggestion.category, tags: tagsInput?.value.trim() ?? "" };
    }
    return null;
  }, [aiStatus, file, requestSuggestion]);

  // Resolve the "Save to Library" gate when the AI request settles so the
  // submit effect unblocks.
  useEffect(() => {
    const pending = pendingLibraryRef.current;
    if (!pending) return;
    if (aiStatus.kind === "ready" || aiStatus.kind === "error" || aiStatus.kind === "idle") {
      pendingLibraryRef.current = null;
      if (aiStatus.kind === "error") pending.reject(new Error(aiStatus.message));
      else pending.resolve();
    }
  }, [aiStatus]);

  async function performSave(submitTarget: SubmitTarget) {
    if (saving || isSubmitting.current) return;
    if (!file) { setError("This image could not be used. Choose a different image."); return; }
    isSubmitting.current = true; setSaving(true); setTarget(submitTarget); setError(null);

    let libraryCategory: string | null = null;
    let libraryTags: string | null = null;
    if (submitTarget === "library") {
      const ensured = await ensureAiForLibrary();
      if (!ensured) {
        setError("The AI service could not suggest a category. Type one manually, then save to Library.");
        isSubmitting.current = false; setSaving(false); setTarget(null);
        return;
      }
      libraryCategory = ensured.category;
      libraryTags = ensured.tags;
    }

    if (!file) { setError("This image could not be used. Choose a different image."); isSubmitting.current = false; setSaving(false); setTarget(null); return; }
    const data = new FormData();
    data.append("file", file, file.name);
    const form = formRef.current;
    if (form) {
      const titleValue = (form.elements.namedItem("title") as HTMLInputElement | null)?.value ?? "";
      const notesValue = (form.elements.namedItem("notes") as HTMLTextAreaElement | null)?.value ?? "";
      const tagsValue = libraryTags ?? (form.elements.namedItem("tags") as HTMLInputElement | null)?.value ?? "";
      if (titleValue.trim()) data.append("title", titleValue.trim());
      if (notesValue.trim()) data.append("notes", notesValue.trim());
      if (tagsValue.trim()) data.append("tags", tagsValue.trim());
    }
    let createdId: string | undefined;
    try {
      const response = await apiRequest<CaptureResponse>("/api/infographics", { method: "POST", body: data });
      createdId = response.kind === "created" ? response.infographicId : undefined;
    } catch (cause) {
      // Surface the actual API message (e.g. "INVALID_MULTIPART: ...") so the
      // owner can act on it instead of getting a generic "try again".
      const detail = cause instanceof ApiClientError
        ? `${cause.status > 0 ? `HTTP ${cause.status}: ` : ""}${cause.message}`.trim()
        : cause instanceof Error ? cause.message : "Unknown error";
      setError({ kind: "api", message: `The infographic could not be saved. ${detail}` });
      isSubmitting.current = false; setSaving(false); setTarget(null);
      return;
    }
    if (submitTarget === "library" && createdId) {
      const tagsValue = libraryTags ?? "";
      const patch: { categories?: { id: string; displayName: string; normalizedName: string; slug: string }[]; tags?: { id: string; displayName: string; normalizedName: string; slug: string }[] } = {};
      if (libraryCategory) {
        const normalized = normalizedName(libraryCategory);
        const existing = knownCategories.find((entry) => entry.normalizedName === normalized);
        patch.categories = [{
          id: existing ? "existing" : crypto.randomUUID(),
          displayName: existing?.displayName ?? libraryCategory,
          normalizedName: normalized,
          slug: slugFor(existing?.displayName ?? libraryCategory),
        }];
      }
      if (tagsValue.trim()) patch.tags = parseTagList(tagsValue, knownTags);
      if ((patch.categories?.length ?? 0) > 0 || (patch.tags?.length ?? 0) > 0) {
        try {
          await apiRequest(`/api/infographics/${encodeURIComponent(createdId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
        } catch {
          setError("The AI-filled fields could not be saved. The image was added, but category and tags were not.");
        }
      }
      router.push(routes.library);
      return;
    }
    // "Save to Inbox" keeps the image unfiled: do NOT PATCH category/tags.
    // The Inbox view filters on `categoryIds.length === 0`, so sending the
    // AI-filled category would silently move the item to Library and the user
    // would land on an empty Inbox. The user can re-run AI from the Inbox row
    // (or type a category manually) before pressing "Move to Library".
    router.push(routes.inbox);
  }

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const button = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const nextTarget: SubmitTarget = button?.dataset["target"] === "library" ? "library" : "inbox";
    void performSave(nextTarget);
  };

  return <form ref={formRef} className="capture-form" onSubmit={handleSave}>
    <PageHeader description="Paste, drop, or choose an image. AI suggestions appear automatically." descriptionId="capture-help" title="Add infographic" />
    <div className="capture-workspace">
      <div className="capture-workspace__media">
        <CaptureDropzone disabled={saving} onChooseClipboard={chooseClipboard} onFile={selectFile} />
        {previewUrl ? <figure className="capture-preview"><img alt="Infographic preview" src={previewUrl} /><figcaption>{file?.name}</figcaption></figure> : <p aria-live="polite" className="visually-hidden">No image selected.</p>}
      </div>
      <div className="capture-workspace__details">
        <AiStatusBanner status={aiStatus} onClear={clearSuggestion} onRetry={retryAi} />
        <section aria-labelledby="optional-details-title" className="capture-details"><h2 id="optional-details-title">Optional details</h2>
          <label>Title<input maxLength={200} name="title" /></label>
          <label>Category<input autoComplete="off" maxLength={80} name="category" placeholder="e.g. AI & Machine Learning" /></label>
          <label>Tags<input autoComplete="off" maxLength={500} name="tags" placeholder="memory, cuda" /></label>
          <label>Notes<textarea maxLength={10000} name="notes" rows={4} /></label>
        </section>
        {error ? <p aria-live="polite" className="form-message form-message--error" role="status">{typeof error === "string" ? error : error.message}</p> : null}
        <div className="capture-form__actions">
          <Button
            className="capture-form__save"
            data-target="inbox"
            disabled={saving}
            type="submit"
            variant="secondary"
          >
            {saving && target === "inbox" ? "Saving to Inbox…" : "Save to Inbox"}
          </Button>
          <Button
            className="capture-form__save capture-form__save--primary"
            data-target="library"
            disabled={saving}
            type="submit"
          >
            <Sparkles aria-hidden="true" size={16} strokeWidth={1.75} />
            {saving && target === "library" ? "Saving to Library…" : "Save to Library"}
          </Button>
        </div>
        <p className="capture-form__hint" id="capture-help-save">Save to Inbox keeps the image unfiled. Save to Library asks AI to fill the category, then organizes it immediately.</p>
      </div>
    </div>
  </form>;
}

function AiStatusBanner({ status, onClear, onRetry }: { status: AiStatus; onClear: () => void; onRetry?: () => void }) {
  if (status.kind === "idle") return null;
  if (status.kind === "loading") {
    return <div aria-live="polite" className="ai-banner ai-banner--loading" role="status"><Sparkles aria-hidden="true" size={18} strokeWidth={1.75} /><span>Reading the image and drafting metadata…</span></div>;
  }
  if (status.kind === "ready") {
    const { suggestion } = status;
    const filled = [suggestion.title, suggestion.notes, suggestion.category, ...(Array.isArray(suggestion.topics) ? suggestion.topics : [])].filter((value) => typeof value === "string" && value.length > 0).length;
    const ratio = Math.round((suggestion.confidence ?? 0) * 100);
    const headline = suggestion.category
      ? <>AI suggested {filled} field{filled === 1 ? "" : "s"} (will move to <strong>{suggestion.category}</strong>).</>
      : <>AI suggested {filled} field{filled === 1 ? "" : "s"}.</>;
    return <div aria-live="polite" className="ai-banner ai-banner--ready" role="status">
      <Sparkles aria-hidden="true" size={18} strokeWidth={1.75} />
      <div className="ai-banner__body">
        <strong>{headline}</strong>
        {suggestion.rationale ? <span>{suggestion.rationale}</span> : null}
        <span className="ai-banner__meta">confidence {ratio}%</span>
      </div>
      <button aria-label="Discard AI suggestions" className="ai-banner__dismiss" onClick={onClear} type="button"><X aria-hidden="true" size={16} strokeWidth={1.75} /></button>
    </div>;
  }
  return <div aria-live="polite" className="ai-banner ai-banner--error" role="status">
    <Sparkles aria-hidden="true" size={18} strokeWidth={1.75} />
    <div className="ai-banner__body">
      <strong>AI suggestion unavailable.</strong>
      <span>{status.message}</span>
      {onRetry ? <div className="ai-banner__actions"><button className="button button--quiet" onClick={onRetry} type="button">Try again</button></div> : null}
    </div>
    <button aria-label="Dismiss AI suggestion status" className="ai-banner__dismiss" onClick={onClear} type="button"><X aria-hidden="true" size={16} strokeWidth={1.75} /></button>
  </div>;
}
