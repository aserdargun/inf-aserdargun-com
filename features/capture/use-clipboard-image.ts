"use client";

import { useEffect } from "react";

interface ClipboardImageOptions {
  onImage: (file: File) => void;
  onReject: () => void;
}

function firstImageFile(items: DataTransferItemList): File | null {
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

export function useClipboardImage({ onImage, onReject }: ClipboardImageOptions) {
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      const file = event.clipboardData ? firstImageFile(event.clipboardData.items) : null;
      if (file) {
        event.preventDefault();
        onImage(file);
      } else if (event.clipboardData) {
        onReject();
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [onImage, onReject]);

  return async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const mime = item.types.find((type) => type.startsWith("image/"));
        if (mime) {
          const blob = await item.getType(mime);
          onImage(new File([blob], "clipboard-image", { type: blob.type || mime }));
          return;
        }
      }
    } catch {
      // Clipboard permission and availability are intentionally not exposed as browser details.
    }
    onReject();
  };
}
