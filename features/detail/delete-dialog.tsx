"use client";

import { useEffect, useRef } from "react";
import { Button } from "../../components/ui/button";

interface DeleteDialogProps { title: string; deleting: boolean; onCancel: () => void; onConfirm: () => void; }
export function DeleteDialog({ title, deleting, onCancel, onConfirm }: DeleteDialogProps) {
  const cancel = useRef<HTMLButtonElement>(null); const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancel.current?.focus(); }, []);
  return <div className="delete-dialog__backdrop"><section aria-describedby="delete-description" aria-labelledby="delete-title" aria-modal="true" className="delete-dialog" onKeyDown={(event) => { if (event.key === "Escape" && !deleting) { event.preventDefault(); onCancel(); return; } if (event.key !== "Tab") return; if (event.shiftKey && document.activeElement === cancel.current) { event.preventDefault(); confirm.current?.focus(); } else if (!event.shiftKey && document.activeElement === confirm.current) { event.preventDefault(); cancel.current?.focus(); } }} role="dialog"><h2 id="delete-title">Delete infographic?</h2><p id="delete-description">{title} will be moved to Trash.</p><div className="delete-dialog__actions"><Button disabled={deleting} onClick={onCancel} ref={cancel} variant="secondary">Cancel</Button><Button className="button--destructive" disabled={deleting} onClick={onConfirm} ref={confirm}>{deleting ? "Deleting…" : "Delete infographic"}</Button></div></section></div>;
}
