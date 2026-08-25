"use client";

import { ImagePlus, Upload } from "lucide-react";
import { Button } from "../../components/ui/button";

interface CaptureDropzoneProps {
  disabled?: boolean;
  onChooseClipboard: () => void;
  onFile: (file: File) => void;
}

export function CaptureDropzone({ disabled = false, onChooseClipboard, onFile }: CaptureDropzoneProps) {
  // The dropzone keeps a labelled region for screen readers and lets the document-level paste
  // listener (see useClipboardImage) accept an image anywhere on the page — desktop and mobile.
  return <section
    aria-describedby="capture-help"
    aria-label="Image capture area. Paste an image, drop one here, or choose a file."
    className="capture-dropzone"
    data-testid="capture-dropzone"
    onDragOver={(event) => event.preventDefault()}
    onDrop={(event) => { event.preventDefault(); const [file] = Array.from(event.dataTransfer.files); if (file) onFile(file); }}
  >
    <ImagePlus aria-hidden="true" className="capture-dropzone__icon" size={64} strokeWidth={1.5} />
    <p className="capture-dropzone__hint">Paste, drop, or choose an image to capture.</p>
    <div className="capture-dropzone__actions">
      <Button disabled={disabled} onClick={(event) => { event.stopPropagation(); void onChooseClipboard(); }}>
        <Upload aria-hidden="true" size={20} strokeWidth={1.75} />
        Paste from clipboard
        <kbd aria-hidden="true">⌘ V</kbd>
      </Button>
      <label aria-disabled={disabled} className={`button button--secondary capture-dropzone__chooser${disabled ? " is-disabled" : ""}`}>
        <span>Choose image</span>
        <input
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          aria-label="Choose infographic"
          className="capture-dropzone__input"
          disabled={disabled}
          onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onFile(file); event.currentTarget.value = ""; }}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
          type="file"
        />
      </label>
    </div>
  </section>;
}
