import type { ReactNode } from "react";

export function StatusRow({ label, tone = "default", value }: { label: string; tone?: "default" | "positive" | "negative"; value: ReactNode }) {
  return <div className={`status-value status-value--${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}
