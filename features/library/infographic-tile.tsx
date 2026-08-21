"use client";

import type { MaterializedInfographic } from "@inf/contracts";

export function InfographicTile({ item }: { item: MaterializedInfographic }) {
  const date = new Date(item.capturedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return <article className="infographic-tile"><a aria-label={`Open ${item.title}`} href={`/infographic/${encodeURIComponent(item.id)}`}><div className="infographic-tile__image"><img alt={item.title} src={`/api/public/images/${encodeURIComponent(item.thumbnailDriveFileId)}`} /></div><div className="infographic-tile__caption"><strong>{item.title}</strong><span>{date}</span></div></a></article>;
}
