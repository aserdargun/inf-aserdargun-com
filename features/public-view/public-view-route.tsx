"use client";

import { useEffect, useState } from "react";
import { PublicDetail } from "./public-detail";
import { PublicGallery } from "./public-gallery";

export function PublicViewRoute() {
  const [detail, setDetail] = useState<boolean | null>(null);
  useEffect(() => setDetail(/^\/view\/[^/]+\/?$/.test(window.location.pathname)), []);
  return detail === null ? null : detail ? <PublicDetail /> : <PublicGallery />;
}
