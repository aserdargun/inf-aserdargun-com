"use client";

import { useEffect, useState } from "react";
import { ApiClientError, apiRequest } from "./api-client";

export type SessionState =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "admin"; owner: string; mode: "github" | "local-bypass" };

export interface SessionResponse {
  authenticated: boolean;
  owner: string;
  mode: "github" | "local-bypass";
}

/**
 * Reads the owner session via `/api/session`. The endpoint returns 401 for
 * anonymous visitors (the SWA anonymous route is owner-only) and 200 with the
 * owner handle for the configured admin. We use the network result to decide
 * whether privileged UI (e.g. detail-page Edit) should be exposed; the same
 * authorizer still enforces access server-side.
 */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await apiRequest<SessionResponse>("/api/session");
        if (cancelled) return;
        setState({ kind: "admin", owner: data.owner, mode: data.mode });
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof ApiClientError && (cause.status === 401 || cause.status === 403)) {
          setState({ kind: "anonymous" });
          return;
        }
        setState({ kind: "anonymous" });
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);
  return state;
}
