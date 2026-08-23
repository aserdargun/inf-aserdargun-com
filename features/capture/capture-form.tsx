"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/page-header";
import { apiRequest } from "../../lib/api-client";
import { routes } from "../../lib/routes";
import { CaptureDropzone } from "./capture-dropzone";
import { useClipboardImage } from "./use-clipboard-image";

const MAX_IMAGE_BYTES = 20_000_000;
const supportedImageMimes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);
type CaptureError = "Choose an image file." | "This image is too large. Choose an image up to 20 MB." | "This image could not be used. Choose a different image." | "The infographic could not be saved. Try again.";

export function CaptureForm() {
  const router = useRouter();
  const currentUrl = useRef<string | null>(null);
  const isSubmitting = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<CaptureError | null>(null);
  const [saving, setSaving] = useState(false);

  const selectFile = useCallback((nextFile: File) => {
    if (!supportedImageMimes.has(nextFile.type)) { setError("Choose an image file."); return; }
    if (nextFile.size > MAX_IMAGE_BYTES) { setError("This image is too large. Choose an image up to 20 MB."); return; }
    const nextUrl = URL.createObjectURL(nextFile);
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = nextUrl;
    setFile(nextFile);
    setPreviewUrl(nextUrl);
    setError(null);
  }, []);
  useEffect(() => () => { if (currentUrl.current) URL.revokeObjectURL(currentUrl.current); }, []);
  const rejectClipboard = useCallback(() => setError("Choose an image file."), []);
  const chooseClipboard = useClipboardImage({ onImage: selectFile, onReject: rejectClipboard });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || isSubmitting.current) return;
    if (!file) { setError("This image could not be used. Choose a different image."); return; }
    isSubmitting.current = true; setSaving(true); setError(null);
    const data = new FormData(event.currentTarget);
    data.append("file", file, file.name);
    for (const key of ["title", "sourceUrl", "sourcePlatform", "notes"]) {
      if (data.get(key) === "") data.delete(key);
    }
    try {
      await apiRequest("/api/infographics", { method: "POST", body: data });
      router.push(routes.inbox);
    } catch {
      setError("The infographic could not be saved. Try again.");
      isSubmitting.current = false; setSaving(false);
    }
  }

  return <form className="capture-form" onSubmit={(event) => void submit(event)}>
    <PageHeader description="Paste, drop, or choose an image." descriptionId="capture-help" title="Add infographic" />
    <div className="capture-workspace">
      <div className="capture-workspace__media">
        <CaptureDropzone disabled={saving} onChooseClipboard={chooseClipboard} onFile={selectFile} />
        {previewUrl ? <figure className="capture-preview"><img alt="Infographic preview" src={previewUrl} /><figcaption>{file?.name}</figcaption></figure> : <p aria-live="polite" className="visually-hidden">No image selected.</p>}
      </div>
      <div className="capture-workspace__details">
        <section aria-labelledby="optional-details-title" className="capture-details"><h2 id="optional-details-title">Optional details</h2>
          <label>Title<input maxLength={200} name="title" /></label>
          <label>Source URL<input name="sourceUrl" type="url" /></label>
          <label>Platform<input maxLength={100} name="sourcePlatform" /></label>
          <label>Notes<textarea maxLength={10000} name="notes" rows={4} /></label>
        </section>
        {error ? <p aria-live="polite" className="form-message form-message--error" role="status">{error}</p> : null}
        <Button className="capture-form__save" disabled={saving} type="submit">{saving ? "Saving to Inbox…" : "Save to Inbox"}</Button>
      </div>
    </div>
  </form>;
}
