"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * The focus set: up to six models a reader has picked out. With 200 models on a chart,
 * colour cannot name each one, so the chart draws everyone as a distribution and the
 * focus set as numbered markers on top.
 *
 * It lives in the URL (`?focus=a,b`) so a view can be shared, and is mirrored to this
 * browser's storage as a convenience; storage can be missing or throw, and the page
 * works without it.
 */
export const MAX_FOCUS = 6;
const STORE = "tb-focus";

interface FocusApi {
  focus: string[];
  /** 1-based marker number for a model key, or 0 when it is not in focus. */
  numberOf: (key: string) => number;
  toggle: (key: string) => void;
  set: (keys: string[]) => void;
}

const Ctx = createContext<FocusApi | null>(null);

function readUrl(): string[] | null {
  try {
    const v = new URLSearchParams(window.location.search).get("focus");
    return v === null ? null : v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_FOCUS);
  } catch {
    return null;
  }
}

function readStore(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_FOCUS) : [];
  } catch {
    return [];
  }
}

function write(keys: string[]) {
  try {
    const url = new URL(window.location.href);
    if (keys.length) url.searchParams.set("focus", keys.join(","));
    else url.searchParams.delete("focus");
    history.replaceState(history.state, "", url.toString());
  } catch {
    /* no URL to write: keep the state in memory */
  }
  try {
    localStorage.setItem(STORE, JSON.stringify(keys));
  } catch {
    /* private mode */
  }
}

export function FocusProvider({ children, known }: { children: React.ReactNode; known?: string[] }) {
  const [focus, setFocus] = useState<string[]>([]);

  useEffect(() => {
    const fromUrl = readUrl();
    const start = fromUrl ?? readStore();
    // Keys that name no model on this page are dropped, so a stale link never shows ghost chips.
    setFocus(known ? start.filter((k) => known.includes(k)) : start);
  }, [known]);

  const set = useCallback((keys: string[]) => {
    const next = [...new Set(keys)].slice(0, MAX_FOCUS);
    setFocus(next);
    write(next);
  }, []);

  const api = useMemo<FocusApi>(
    () => ({
      focus,
      numberOf: (key) => focus.indexOf(key) + 1,
      toggle: (key) => set(focus.includes(key) ? focus.filter((k) => k !== key) : [...focus, key].slice(-MAX_FOCUS)),
      set,
    }),
    [focus, set],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

const NOOP: FocusApi = { focus: [], numberOf: () => 0, toggle: () => {}, set: () => {} };

/** The focus set, or an empty one outside a provider (a chart still draws, just unfocused). */
export function useFocus(): FocusApi {
  return useContext(Ctx) ?? NOOP;
}
