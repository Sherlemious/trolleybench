"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { displayName, shortChannel } from "../lib/display";
import { MAX_FOCUS, useFocus } from "./focus";

export interface PickerModel {
  /** modelKey(label): one entry per model across modes and channels. */
  key: string;
  label: string;
  company: string;
  slot: number;
}

/**
 * Pick models to focus on: a search box over every model, grouped by company, plus the
 * current picks as numbered chips. Built for hundreds of models - it lists matches, not
 * everything, and the keyboard drives it (arrows, Enter, Escape).
 */
export default function ModelPicker({ models, label = "Highlight models" }: { models: PickerModel[]; label?: string }) {
  const { focus, toggle, set, numberOf } = useFocus();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  const byKey = useMemo(() => new Map(models.map((m) => [m.key, m])), [models]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = models.filter((m) => !q || m.label.toLowerCase().includes(q) || displayName(m.label).name.toLowerCase().includes(q) || m.company.toLowerCase().includes(q));
    return hit.sort((a, b) => a.company.localeCompare(b.company) || displayName(a.label).name.localeCompare(displayName(b.label).name)).slice(0, 60);
  }, [models, query]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  useEffect(() => setCursor(0), [query]);

  const choose = (key: string) => {
    toggle(key);
    setQuery("");
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setCursor((c) => Math.min(c + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && open && matches[cursor]) {
      e.preventDefault();
      choose(matches[cursor]!.key);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && query === "" && focus.length) {
      set(focus.slice(0, -1));
    }
  };

  const full = focus.length >= MAX_FOCUS;
  let lastCompany = "";

  return (
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
          aria-autocomplete="list"
          aria-label={label}
          placeholder={full ? `${MAX_FOCUS} highlighted: remove one to add another` : `${label}: search ${models.length} models`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
      </div>
      {focus.length > 0 ? (
        <ul className="picker-chips" aria-label="Highlighted models">
          {focus.map((k) => {
            const m = byKey.get(k);
            const d = displayName(m?.label ?? k);
            return (
              <li key={k} className={`s${m?.slot ?? 9}`}>
                <span className="fmk" aria-hidden="true">
                  {numberOf(k)}
                </span>
                <span className="picker-chip-name" title={m?.label ?? k}>
                  {d.name}
                </span>
                <button type="button" onClick={() => toggle(k)} aria-label={`Stop highlighting ${d.name}`}>
                  ×
                </button>
              </li>
            );
          })}
          <li className="picker-clear">
            <button type="button" onClick={() => set([])}>
              Clear
            </button>
          </li>
        </ul>
      ) : null}
      {open ? (
        <ul className="picker-pop" role="listbox" id={listId} aria-label="Models">
          {matches.length === 0 ? <li className="picker-empty">No model matches “{query}”.</li> : null}
          {matches.map((m, i) => {
            const d = displayName(m.label);
            const head = m.company !== lastCompany ? m.company : null;
            lastCompany = m.company;
            const on = focus.includes(m.key);
            return (
              <li key={m.key} role="presentation">
                {head ? <span className="picker-group">{head}</span> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`picker-opt s${m.slot}${i === cursor ? " cur" : ""}`}
                  disabled={!on && full}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(m.key)}
                >
                  <i className="dot" aria-hidden="true" />
                  <span className="nm">{d.name}</span>
                  {d.channel ? <span className="ch">{shortChannel(d.channel)}</span> : null}
                  <span className="tick" aria-hidden="true">
                    {on ? numberOf(m.key) : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
