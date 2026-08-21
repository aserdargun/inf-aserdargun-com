import type { ReactNode } from "react";
import { CircleAlert, Inbox, LoaderCircle } from "lucide-react";
import { Button } from "./button";
interface PageStateProps { action?: ReactNode; description?: string; kind: "loading" | "empty" | "error"; title: string; }
export function PageState({ action, description, kind, title }: PageStateProps) { const Icon = kind === "loading" ? LoaderCircle : kind === "error" ? CircleAlert : Inbox; return <section aria-live="polite" className={`page-state page-state--${kind}`}><Icon aria-hidden="true" className={kind === "loading" ? "is-spinning" : ""} size={24} strokeWidth={1.75} /><div><p className="page-state__title">{title}</p>{description ? <p>{description}</p> : null}</div>{action}</section>; }
export function RetryButton({ onRetry }: { onRetry: () => void }) { return <Button onClick={onRetry} variant="secondary">Try again</Button>; }
