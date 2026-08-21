import type { ReactNode } from "react";

export function PublicShell({ children }: { children: ReactNode }) {
  return <main className="public-view"><header className="public-view__bar"><a href="/view/" className="public-view__wordmark" aria-label="INF home">INF</a></header>{children}<footer className="public-view__footer"><strong>INF</strong><span>View only</span></footer></main>;
}
