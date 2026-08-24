"use client";

import { useEffect, useState } from "react";
import { PublicDetail } from "./public-detail";
import { PublicGallery } from "./public-gallery";

// While the client effect has not yet resolved, render a stable placeholder so
// the SSR shell has something to display and the visible viewport does not
// collapse to zero height (which would otherwise delay LCP).
function PublicRoutePlaceholder() {
  return <div aria-hidden="true" className="public-route-placeholder" />;
}

export function PublicViewRoute() {
  const [detail, setDetail] = useState<boolean | null>(null);
  useEffect(() => setDetail(/^\/view\/[^/]+\/?$/.test(window.location.pathname)), []);
  if (detail === null) return <PublicRoutePlaceholder />;
  return detail ? <PublicDetail /> : <PublicGallery />;
}
