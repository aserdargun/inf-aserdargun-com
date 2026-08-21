"use client";

import { ImagePlus, Upload } from "lucide-react";
import { useRef } from "react";
import { Button } from "../../components/ui/button";

interface CaptureDropzoneProps {
  disabled?: boolean;
  onChooseClipboard: () => void;
  onFile: (file: File) => void;
}

export function CaptureDropzone({ disabled = false, onChooseClipboard, onFile }: CaptureDropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const choose = () => input.current?.click();
  return <section
    aria-describedby="capture-help"
    aria-label="Image capture area"
    className="capture-dropzone"
    data-testid="capture-dropzone"
    onDragOver={(event) => event.preventDefault()}
    onDrop={(event) => { event.preventDefault(); const [file] = Array.from(event.dataTransfer.files); if (file) onFile(file); }}
  >
    <input accept="image/png,image/jpeg,image/webp,image/gif,image/avif" aria-label="Choose infographic" className="capture-dropzone__input" disabled={disabled} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onFile(file); event.currentTarget.value = ""; }} ref={input} tabIndex={-1} type="file" />
    <ImagePlus aria-hidden="true" className="capture-dropzone__icon" size={64} strokeWidth={1.5} />
    <div className="capture-dropzone__actions">
      <Button disabled={disabled} onClick={(event) => { event.stopPropagation(); void onChooseClipboard(); }}><Upload aria-hidden="true" size={20} strokeWidth={1.75} />Paste from clipboard <kbd>⌘ V</kbd></Button>
      <Button disabled={disabled} onClick={(event) => { event.stopPropagation(); choose(); }} variant="secondary">Choose image</Button>
    </div>
  </section>;
}
