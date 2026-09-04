"use client";

import type { Category, Tag } from "@inf/contracts";
import { useEffect, useRef } from "react";

export type LibrarySort = "recent" | "least-seen";
export interface LibraryFiltersValue { q: string; category: string; tag: string; favorite: boolean; sort: LibrarySort; }
interface LibraryFiltersProps { categories: readonly Category[]; tags: readonly Tag[]; value: LibraryFiltersValue; onChange: (next: LibraryFiltersValue) => void; onClear: () => void; }
type UpdateFilter = <K extends keyof LibraryFiltersValue>(key: K, next: LibraryFiltersValue[K]) => void;
type FilterFieldsProps = Pick<LibraryFiltersProps, "categories" | "tags" | "value" | "onClear"> & { update: UpdateFilter };

export function activeFilterCount(value: LibraryFiltersValue) {
  return Number(Boolean(value.category)) + Number(Boolean(value.tag)) + Number(value.favorite) + Number(value.sort !== "recent");
}

function FilterFields({ categories, tags, value, update, onClear }: FilterFieldsProps) {
  return <>
    <label>Category<select aria-label="Category" onChange={(event) => update("category", event.currentTarget.value)} value={value.category}><option value="">Category</option>{categories.map((entry) => <option key={entry.id} value={entry.slug}>{entry.displayName}</option>)}</select></label>
    <label>Tag<select aria-label="Tag" onChange={(event) => update("tag", event.currentTarget.value)} value={value.tag}><option value="">Tag</option>{tags.map((entry) => <option key={entry.id} value={entry.slug}>{entry.displayName}</option>)}</select></label>
    <label className="library-filters__check"><input aria-label="Favorite" checked={value.favorite} onChange={(event) => update("favorite", event.currentTarget.checked)} type="checkbox" /><span>Favorite</span></label>
    <label>Sort<select aria-label="Sort" onChange={(event) => update("sort", event.currentTarget.value as LibrarySort)} value={value.sort}><option value="recent">Recently added</option><option value="least-seen">Least recently seen</option></select></label>
    <button className="button button--quiet" onClick={onClear} type="button">Clear filters</button>
  </>;
}

export function LibraryFilters({ categories, tags, value, onChange, onClear }: LibraryFiltersProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreTriggerOnClose = useRef(true);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1100px)");
    const closeForDesktop = (event: MediaQueryListEvent) => {
      if (!event.matches || !dialogRef.current?.open) return;
      restoreTriggerOnClose.current = false;
      dialogRef.current.close();
    };
    desktop.addEventListener("change", closeForDesktop);
    return () => desktop.removeEventListener("change", closeForDesktop);
  }, []);
  const update = <K extends keyof LibraryFiltersValue>(key: K, next: LibraryFiltersValue[K]) => onChange({ ...value, [key]: next });
  const count = activeFilterCount(value);
  const openFilters = () => dialogRef.current?.showModal();
  const closeFilters = () => dialogRef.current?.close();
  const restoreTrigger = () => {
    if (!restoreTriggerOnClose.current) {
      restoreTriggerOnClose.current = true;
      return;
    }
    queueMicrotask(() => triggerRef.current?.focus());
  };
  return <div className="library-filters">
    <label className="library-filters__search"><span className="visually-hidden">Search library</span><input aria-label="Search library" onChange={(event) => update("q", event.currentTarget.value)} placeholder="Search library" type="search" value={value.q} /></label>
    <form aria-label="Library filters" className="library-filters__desktop" onSubmit={(event) => event.preventDefault()}><FilterFields categories={categories} onClear={onClear} tags={tags} update={update} value={value} /></form>
    <button aria-haspopup="dialog" className="button button--secondary library-filter-trigger" onClick={openFilters} ref={triggerRef} type="button">{count ? `Filters (${count})` : "Filters"}</button>
    <dialog aria-label="Library filters" className="library-filter-dialog" onClose={restoreTrigger} ref={dialogRef}>
      <form className="library-filter-dialog__form" method="dialog"><FilterFields categories={categories} onClear={onClear} tags={tags} update={update} value={value} /><button className="button button--primary" onClick={closeFilters} type="button">Done</button></form>
    </dialog>
  </div>;
}
