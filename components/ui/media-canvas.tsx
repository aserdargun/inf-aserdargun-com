import type { ReactNode } from "react";

type MediaCanvasVariant = "thumbnail" | "gallery" | "detail" | "learning" | "preview";

export function MediaCanvas({ children, className = "", variant }: { children: ReactNode; className?: string; variant: MediaCanvasVariant }) {
  return <div className={`media-canvas media-canvas--${variant} ${className}`.trim()}>{children}</div>;
}
