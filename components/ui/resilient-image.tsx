"use client";

import { useCallback, useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";

type ResilientImageProps = Omit<ComponentPropsWithoutRef<"img">, "alt" | "onError" | "src"> & {
  alt: string;
  fallbackLabel: string;
  fallbackText: string;
  src: string;
};

function retryUrl(src: string): string {
  const separator = src.includes("?") ? "&" : "?";
  return `${src}${separator}inf_retry=1`;
}

/** Retries a transient media failure once, including failures that happen before hydration. */
export function ResilientImage({ alt, fallbackLabel, fallbackText, src, ...props }: ResilientImageProps) {
  const [attempt, setAttempt] = useState<0 | 1>(0);
  const [failed, setFailed] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFailure = useCallback(() => {
    if (attempt === 0) {
      if (retryTimer.current !== null) return;
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        setAttempt(1);
      }, 600);
      return;
    }
    setFailed(true);
  }, [attempt]);

  const imageRef = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth === 0) handleFailure();
  }, [handleFailure]);

  useEffect(() => () => {
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
  }, []);

  if (failed) return <span aria-label={fallbackLabel} className="media-canvas__error" role="img">{fallbackText}</span>;
  return <img {...props} alt={alt} onError={handleFailure} ref={imageRef} src={attempt === 0 ? src : retryUrl(src)} />;
}
