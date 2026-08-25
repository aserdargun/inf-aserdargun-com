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
type CaptureError = "Choose an image file." | "This image is too large. Choose an image up to 20 MB." | "This image could not be used. Choose a different image." | "The infographic could not be saved. Try again." | "The AI-filled fields could not be saved. The image was added, but category and tags were not.";

interface AiSuggestion {
  title: string | null;
  notes: string | null;
  sourceUrl: string | null;
  sourcePlatform: string | null;
  sourceAuthor: string | null;
  language: string | null;
  category: string | null;
  topics: string[];
  rationale: string | null;
  confidence: number;
}

type AiStatus = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; suggestion: AiSuggestion } | { kind: "error"; message: string };

const fieldKeys = ["title", "sourceUrl", "sourcePlatform", "sourceAuthor", "notes", "category", "tags"] as const;
type FieldKey = (typeof fieldKeys)[number];

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
  const [error, setError] = useState<CaptureError | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ kind: "idle" });
  const [knownCategories, setKnownCategories] = useState<readonly { displayName: string; normalizedName: string }[]>([]);
  const [knownTags, setKnownTags] = useState<readonly { displayName: string; normalizedName: string }[]>([]);

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
      if (suggestion.sourceUrl) { setFieldValue("sourceUrl", suggestion.sourceUrl); applied.push("sourceUrl"); }
      if (suggestion.sourcePlatform) { setFieldValue("sourcePlatform", suggestion.sourcePlatform); applied.push("sourcePlatform"); }
      if (suggestion.sourceAuthor) { setFieldValue("sourceAuthor", suggestion.sourceAuthor); applied.push("sourceAuthor"); }
      if (suggestion.notes) { setFieldValue("notes", suggestion.notes); applied.push("notes"); }
      if (suggestion.category) { setFieldValue("category", suggestion.category); applied.push("category"); }
      if (Array.isArray(suggestion.topics) && suggestion.topics.length > 0) {
        const topicText = suggestion.topics.map((topic) => topic.normalize("NFKC").trim()).filter(Boolean).join(", ");
        if (topicText) { setFieldValue("tags", topicText); applied.push("tags"); }
      }
      // Pull the existing category/tag catalogs so the PATCH at save time can dedupe by display name.
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || isSubmitting.current) return;
    if (!file) { setError("This image could not be used. Choose a different image."); return; }
    isSubmitting.current = true; setSaving(true); setError(null);
    const data = new FormData(event.currentTarget);
    data.append("file", file, file.name);
    for (const key of fieldKeys) {
      if (data.get(key) === "") data.delete(key);
    }
    let createdId: string | undefined;
    try {
      const response = await apiRequest<CaptureResponse>("/api/infographics", { method: "POST", body: data });
      createdId = response.kind === "created" ? response.infographicId : undefined;
    } catch {
      setError("The infographic could not be saved. Try again.");
      isSubmitting.current = false; setSaving(false);
      return;
    }
    // After capture, apply AI-suggested category and tags with a PATCH. The capture API doesn't
    // accept them directly yet, so this keeps the "AI filled all fields on first add" promise.
    if (createdId) {
      const form = formRef.current;
      const categoryValue = (form?.elements.namedItem("category") as HTMLInputElement | null)?.value.trim() ?? "";
      const tagsValue = (form?.elements.namedItem("tags") as HTMLInputElement | null)?.value.trim() ?? "";
      const patch: { categories?: { id: string; displayName: string; normalizedName: string; slug: string }[]; tags?: { id: string; displayName: string; normalizedName: string; slug: string }[] } = {};
      if (categoryValue) {
        const normalized = normalizedName(categoryValue);
        const existing = knownCategories.find((entry) => entry.normalizedName === normalized);
        patch.categories = [{
          id: existing ? "existing" : crypto.randomUUID(),
          displayName: existing?.displayName ?? categoryValue,
          normalizedName: normalized,
          slug: slugFor(existing?.displayName ?? categoryValue),
        }];
      }
      if (tagsValue) patch.tags = parseTagList(tagsValue, knownTags);
      if ((patch.categories?.length ?? 0) > 0 || (patch.tags?.length ?? 0) > 0) {
        try {
          await apiRequest(`/api/infographics/${encodeURIComponent(createdId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
        } catch {
          setError("The AI-filled fields could not be saved. The image was added, but category and tags were not.");
        }
      }
    }
    router.push(routes.inbox);
  }

  return <form ref={formRef} className="capture-form" onSubmit={(event) => void submit(event)}>
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
          <label>Source URL<input name="sourceUrl" type="url" /></label>
          <label>Platform<input maxLength={100} name="sourcePlatform" /></label>
          <label>Category<input autoComplete="off" maxLength={80} name="category" placeholder="e.g. AI & Machine Learning" /></label>
          <label>Tags<input autoComplete="off" maxLength={500} name="tags" placeholder="memory, cuda" /></label>
          <label>Notes<textarea maxLength={10000} name="notes" rows={4} /></label>
        </section>
        {error ? <p aria-live="polite" className="form-message form-message--error" role="status">{error}</p> : null}
        <Button className="capture-form__save" disabled={saving} type="submit">{saving ? "Saving to Inbox…" : "Save to Inbox"}</Button>
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
    const filled = [suggestion.title, suggestion.sourceUrl, suggestion.sourcePlatform, suggestion.sourceAuthor, suggestion.notes, suggestion.category, ...(Array.isArray(suggestion.topics) ? suggestion.topics : [])].filter((value) => typeof value === "string" && value.length > 0).length;
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
