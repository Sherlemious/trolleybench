"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { displayName, shortChannel } from "../../lib/display";

export interface SwitcherEntry {
  id: string;
  label: string;
  company: string;
  slot: number;
  /** "asked", "acting", plus the pack when it is not the canon. */
  tag: string;
  isStub: boolean;
}

/**
 * Jump to another model's page: a search box over every entry, grouped by company, with
 * each entry's mode and pack as a tag. Replaces a cloud of chips that stopped working
 * somewhere past a dozen models.
 */
export default function RunSwitcher({ entries, current }: { entries: SwitcherEntry[]; current: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => !q || e.label.toLowerCase().includes(q) || displayName(e.label).name.toLowerCase().includes(q) || e.company.toLowerCase().includes(q))
      .sort((a, b) => Number(a.isStub) - Number(b.isStub) || a.company.localeCompare(b.company) || displayName(a.label).name.localeCompare(displayName(b.label).name) || a.tag.localeCompare(b.tag))
      .slice(0, 80);
  }, [entries, query]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  useEffect(() => setCursor(0), [query]);

  const go = (id: string) => {
    setOpen(false);
    router.push(`/results/${encodeURIComponent(id)}`);
  };

  let last = "";
  return (
    <div className="run-switch">
      <Link href="/results" className="ghost back">
        ← All results
      </Link>
      <div className="picker" ref={root}>
        <div className="picker-field">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-label="Go to another model"
            placeholder={`Go to another model (${entries.length})`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setCursor((c) => Math.min(c + 1, matches.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter" && matches[cursor]) {
                e.preventDefault();
                go(matches[cursor]!.id);
              } else if (e.key === "Escape") setOpen(false);
            }}
          />
        </div>
        {open ? (
          <ul className="picker-pop" role="listbox" id={listId}>
            {matches.length === 0 ? <li className="picker-empty">No model matches “{query}”.</li> : null}
            {matches.map((e, i) => {
              const d = displayName(e.label);
              const head = e.company !== last ? e.company : null;
              last = e.company;
              return (
                <li key={e.id} role="presentation">
                  {head ? <span className="picker-group">{head}</span> : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={e.id === current}
                    className={`picker-opt s${e.slot}${i === cursor ? " cur" : ""}`}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(e.id)}
                  >
                    <i className="dot" aria-hidden="true" />
                    <span className="nm">{d.name}</span>
                    {d.channel ? <span className="ch">{shortChannel(d.channel)}</span> : null}
                    <span className="ch">{e.isStub ? "test double" : e.tag}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
