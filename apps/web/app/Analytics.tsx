"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * One page_view per route, including client-side navigation. The site is a single-page
 * app after the first load, and GA's automatic history tracking dropped or delayed those
 * views, so the tag is configured with send_page_view: false and this sends them instead.
 * (Turn off "Page changes based on browser history events" in the GA data stream's
 * enhanced measurement, or views would be counted twice.)
 */
export default function Analytics() {
  const pathname = usePathname();
  const search = useSearchParams();
  const last = useRef<string | null>(null);

  useEffect(() => {
    const qs = search?.toString();
    const path = qs ? `${pathname}?${qs}` : pathname;
    if (!path || last.current === path) return;
    last.current = path;
    window.gtag?.("event", "page_view", {
      page_path: path,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname, search]);

  return null;
}
