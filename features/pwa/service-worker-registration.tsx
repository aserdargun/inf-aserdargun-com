"use client";

import { useEffect } from "react";

/** Registers after hydration so rendering never waits on PWA support. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    const loopback = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "[::1]";
    const worker = navigator.serviceWorker;
    if (!worker || (!loopback && !window.isSecureContext)) return;
    void worker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
