"use client";

import { useEffect, useState } from "react";
import { ApiClientError, apiRequest } from "./api-client";

export type SessionState =
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
 * owner handle for the configured admin.
 *
 * We optimistically start as `anonymous` so the first render of consumers
 * (e.g. the detail page) does not have to wait for the network round trip
 * before painting privileged UI affordances or its read-only state. The
 * session flips to `admin` as soon as the endpoint confirms it; the same
 * server-side authorizer still gates privileged actions, so the optimistic
 * state cannot leak access to anything the user could not already reach.
 */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ kind: "anonymous" });
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await apiRequest<SessionResponse>("/api/session");
        if (cancelled) return;
        setState({ kind: "admin", owner: data.owner, mode: data.mode });
      } catch {
        // Anonymous visitors receive 401; any other failure is treated as
        // anonymous for UI safety. Privileged mutations remain blocked by the
        // server-side authorizer regardless of what the client believes.
        if (cancelled) return;
        setState({ kind: "anonymous" });
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);
  return state;
}
