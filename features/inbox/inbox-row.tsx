"use client";

import type { Category, InfographicPatch, MaterializedInfographic, Tag } from "@inf/contracts";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { apiRequest } from "../../lib/api-client";
import { CategoryEditor } from "./category-editor";
import { TagEditor } from "./tag-editor";

interface InboxRowProps { item: MaterializedInfographic; categories: readonly Category[]; tags: readonly Tag[]; onMoved: () => void; }

function normalizedName(value: string) { return value.normalize("NFKC").trim().toLocaleLowerCase("en-US"); }
function slugFor(value: string) {
  const slug = normalizedName(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "tag";
}
function createTaxonomy<T extends Category | Tag>(displayName: string, known: readonly T[]): T {
  const normalized = normalizedName(displayName);
  const existing = known.find((candidate) => candidate.normalizedName === normalized);
  if (existing) return existing;
  return { id: crypto.randomUUID(), displayName: displayName.trim(), normalizedName: normalized, slug: slugFor(displayName) } as T;
}

/** Splits comma-delimited tags by canonical identity while retaining the first typed display form. */
export function parseTags(value: string, known: readonly Tag[]): Tag[] {
  const identity = new Set<string>();
  const result: Tag[] = [];
  for (const displayName of value.split(",").map((part) => part.normalize("NFKC").trim()).filter(Boolean)) {
    const normalized = normalizedName(displayName);
    if (identity.has(normalized)) continue;
    identity.add(normalized);
    result.push(createTaxonomy(displayName, known));
  }
  return result;
}

export function InboxRow({ item, categories, tags, onMoved }: InboxRowProps) {
  const [title, setTitle] = useState(item.title);
  const [category, setCategory] = useState("");
  const [tagText, setTagText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  async function apply() {
    if (saving) return;
    const patch: InfographicPatch = {};
    if (title.trim() && title.trim() !== item.title) patch.title = title.trim();
    if (category.trim()) patch.categories = [createTaxonomy<Category>(category, categories)];
    if (tagText.trim()) patch.tags = parseTags(tagText, tags);
    if (Object.keys(patch).length === 0) return;
    setSaving(true); setError(false);
    try {
      await apiRequest(`/api/infographics/${encodeURIComponent(item.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (patch.categories?.length) onMoved();
      else setSaving(false);
    } catch { setSaving(false); setError(true); }
  }
  return <article className="inbox-row">
    <img alt={item.title} className="inbox-row__image" src={`/api/public/images/${encodeURIComponent(item.thumbnailDriveFileId)}`} />
    <div className="inbox-row__content"><div className="inbox-row__heading"><strong>{item.title}</strong><span>{new Date(item.capturedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></div>
      <div className="inbox-editor"><label className="inbox-editor__field">Title<input aria-label="Title" maxLength={200} onChange={(event) => setTitle(event.currentTarget.value)} value={title} /></label><CategoryEditor categories={categories} onChange={setCategory} value={category} /><TagEditor onChange={setTagText} tags={tags} value={tagText} /></div>
      {error ? <p aria-live="polite" className="form-message form-message--error" role="status">Changes could not be saved. Try again.</p> : null}
      <Button disabled={saving} onClick={() => void apply()}>{saving ? "Saving to Inbox…" : "Apply"}</Button>
    </div>
  </article>;
}
