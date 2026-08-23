import type { ReactNode } from "react";
import { ServiceWorkerRegistration } from "../features/pwa/service-worker-registration";

export function PublicShell({ children }: { children: ReactNode }) {
  return <main className="public-view"><header className="public-view__bar"><a href="/view/" className="public-view__wordmark" aria-label="Infographics home">Infographics</a><a href="/login/" className="public-view__admin-link">Admin sign in</a></header><div className="public-view__body">{children}</div><footer className="public-view__footer"><strong>Infographics</strong><span>View only</span></footer><ServiceWorkerRegistration /></main>;
}
