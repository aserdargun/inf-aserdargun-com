"use client";

import type { MaterializedInfographic } from "@inf/contracts";
import { InfographicTile } from "./infographic-tile";

export function LibraryGrid({ items }: { items: readonly MaterializedInfographic[] }) {
  return <section aria-label="Library results" className="library-grid">{items.map((item) => <InfographicTile item={item} key={item.id} />)}</section>;
}
