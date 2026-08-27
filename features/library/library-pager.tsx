"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

interface LibraryPagerProps {
  page: number;
  totalPages: number;
  totalItems: number;
  onChange: (next: number) => void;
}

export function LibraryPager({ page, totalPages, totalItems, onChange }: LibraryPagerProps) {
  if (!Number.isFinite(totalPages) || totalPages <= 1) return null;
  const goPrevious = () => onChange(page - 1);
  const goNext = () => onChange(page + 1);
  return <nav aria-label="Library pages" className="library-pager">
    <button aria-label="Previous page" className="button button--secondary library-pager__nav" disabled={page <= 1} onClick={goPrevious} type="button">
      <ChevronLeft aria-hidden="true" size={18} strokeWidth={1.75} />Previous
    </button>
    <p aria-live="polite" className="library-pager__status">
      Page <strong>{page}</strong> of <strong>{totalPages}</strong>
      <span className="library-pager__count"> · {totalItems} infographic{totalItems === 1 ? "" : "s"}</span>
    </p>
    <button aria-label="Next page" className="button button--secondary library-pager__nav" disabled={page >= totalPages} onClick={goNext} type="button">
      Next<ChevronRight aria-hidden="true" size={18} strokeWidth={1.75} />
    </button>
  </nav>;
}
