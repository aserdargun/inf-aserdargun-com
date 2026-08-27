"use client";

import type { Category } from "@inf/contracts";

interface CategoryEditorProps { categories: readonly Category[]; value: string; onChange: (value: string) => void; }

export function CategoryEditor({ categories, value, onChange }: CategoryEditorProps) {
  return <label className="taxonomy-editor__field">Category<input aria-label="Category" autoComplete="off" list="taxonomy-categories" onChange={(event) => onChange(event.currentTarget.value)} value={value} />
    <datalist id="taxonomy-categories">{categories.map((category) => <option key={category.id} value={category.displayName} />)}</datalist>
  </label>;
}
