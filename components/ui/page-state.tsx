import type { ReactNode } from "react";
import { BookOpen, CircleAlert, LoaderCircle, type LucideIcon } from "lucide-react";
import { Button } from "./button";
interface PageStateProps { action?: ReactNode; className?: string; description?: string; icon?: LucideIcon; kind: "loading" | "empty" | "error"; layout?: "compact" | "stage"; title: string; }
export function PageState({ action, className = "", description, icon, kind, layout, title }: PageStateProps) { const Icon = icon ?? (kind === "loading" ? LoaderCircle : kind === "error" ? CircleAlert : BookOpen); return <section aria-live="polite" className={`page-state page-state--${kind} ${className}`.trim()} data-layout={layout}><Icon aria-hidden="true" className={kind === "loading" ? "is-spinning" : ""} size={24} strokeWidth={1.75} /><div><p className="page-state__title">{title}</p>{description ? <p>{description}</p> : null}</div>{action}</section>; }
export function RetryButton({ onRetry }: { onRetry: () => void }) { return <Button onClick={onRetry} variant="secondary">Try again</Button>; }
