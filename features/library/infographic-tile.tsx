"use client";

import type { MaterializedInfographic } from "@inf/contracts";

// Library tiles reuse the same 4:3 box as the rail. Render the photo at a 1.5x
// device-pixel ratio so HiDPI screens do not request a second file later.
const TILE_WIDTH = 320;
const TILE_HEIGHT = 240;

export function InfographicTile({ item }: { item: MaterializedInfographic }) {
  const date = new Date(item.capturedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return <article className="infographic-tile"><a aria-label={`Open ${item.title}`} href={`/infographic/${encodeURIComponent(item.id)}`}><div className="infographic-tile__image"><img alt={item.title} decoding="async" height={TILE_HEIGHT} loading="lazy" src={`/api/public/images/${encodeURIComponent(item.thumbnailDriveFileId)}`} width={TILE_WIDTH} /></div><div className="infographic-tile__caption"><strong>{item.title}</strong><span>{date}</span></div></a></article>;
}
