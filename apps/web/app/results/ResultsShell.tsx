"use client";

import { useEffect, useState } from "react";
import { FocusProvider } from "../focus";

/**
 * The results page's only page-wide client state: which pack is showing, and which models
 * are highlighted. Every pack section is rendered on the server and passed in as children;
 * this shell only switches between them and provides the focus set to the islands inside.
 *
 * Packs are tabs because their act rates measure different dilemmas and must never sit in
 * one table. The pack lives in the URL hash (`#ai-agent`), the highlighted models in
 * `?focus=`.
 */
export default function ResultsShell({
  tabs,
  known,
  children,
}: {
  tabs: Array<{ pack: string; tab: string; modelCount: number }>;
  known: string[];
  children: React.ReactNode;
}) {
  const [pack, setPack] = useState(tabs[0]?.pack ?? "");

  useEffect(() => {
    const read = () => {
      const p = window.location.hash.slice(1).split("/")[0];
      if (p && tabs.some((t) => t.pack === p)) setPack(p);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [tabs]);

  const go = (p: string) => {
    setPack(p);
    history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}#${p}`);
  };

  return (
    <FocusProvider known={known}>
      <div className="rtabs">
        {/* Hide every pack but the current one. Server-rendered, so the first pack shows before hydration. */}
        <style>{`.rtabs [data-pack]:not([data-pack="${pack.replace(/[^\w.-]/g, "")}"]){display:none}`}</style>
        {tabs.length > 1 ? (
          <div className="rtabs-packs" role="tablist" aria-label="Scenario pack">
            {tabs.map((t) => (
              <button key={t.pack} type="button" role="tab" aria-selected={t.pack === pack} className="rtab" onClick={() => go(t.pack)}>
                <span className="rtab-name">{t.tab}</span>
                <span className="rtab-sub">
                  {t.modelCount} model{t.modelCount === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {children}
      </div>
    </FocusProvider>
  );
}
