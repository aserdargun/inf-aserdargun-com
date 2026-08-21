"use client";

import type { Tag } from "@inf/contracts";

interface TagEditorProps { tags: readonly Tag[]; value: string; onChange: (value: string) => void; }

export function TagEditor({ tags, value, onChange }: TagEditorProps) {
  return <label className="inbox-editor__field">Tags<input aria-label="Tags" autoComplete="off" list="inbox-tags" onChange={(event) => onChange(event.currentTarget.value)} placeholder="memory, cuda" value={value} />
    <datalist id="inbox-tags">{tags.map((tag) => <option key={tag.id} value={tag.displayName} />)}</datalist>
  </label>;
}
