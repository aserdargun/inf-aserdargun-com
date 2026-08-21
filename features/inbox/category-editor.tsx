"use client";

import type { Category } from "@inf/contracts";

interface CategoryEditorProps { categories: readonly Category[]; value: string; onChange: (value: string) => void; }

export function CategoryEditor({ categories, value, onChange }: CategoryEditorProps) {
  return <label className="inbox-editor__field">Category<input aria-label="Category" autoComplete="off" list="inbox-categories" onChange={(event) => onChange(event.currentTarget.value)} value={value} />
    <datalist id="inbox-categories">{categories.map((category) => <option key={category.id} value={category.displayName} />)}</datalist>
  </label>;
}
