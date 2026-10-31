"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The theme menu: a whole-site theme and an accent colour, chosen independently. The
 * choice is a per-browser convenience kept in localStorage (which can be missing or
 * throw); the boot script in layout.tsx applies it before first paint.
 */
export const THEMES = [
  { id: "system", label: "System", mode: null, swatch: ["#fbfaf7", "#15181c"] },
  { id: "light", label: "Light", mode: "light", swatch: ["#fbfaf7", "#15181c"] },
  { id: "dark", label: "Dark", mode: "dark", swatch: ["#0e1116", "#eef0f2"] },
  { id: "sepia", label: "Sepia", mode: "light", swatch: ["#f3ead8", "#2b2117"] },
  { id: "midnight", label: "Midnight", mode: "dark", swatch: ["#0a0f1e", "#e8ecf7"] },
  { id: "terminal", label: "Terminal", mode: "dark", swatch: ["#040705", "#d4f7dc"] },
] as const;

export const ACCENTS = [
  { id: "amber", label: "Signal amber", color: "#f4b400" },
  { id: "blue", label: "Rail blue", color: "#2a64d8" },
  { id: "green", label: "Moss green", color: "#1c7f45" },
  { id: "red", label: "Ember red", color: "#d1343a" },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];
type AccentId = (typeof ACCENTS)[number]["id"];

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}

function apply(theme: ThemeId, accent: AccentId) {
  const root = document.documentElement;
  const t = THEMES.find((x) => x.id === theme)!;
  if (theme === "system") {
    root.removeAttribute("data-theme");
    root.removeAttribute("data-mode");
  } else {
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-mode", t.mode!);
  }
  if (accent === "amber") root.removeAttribute("data-accent");
  else root.setAttribute("data-accent", accent);
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeId>("system");
  const [accent, setAccent] = useState<AccentId>("amber");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTheme(read("tb-theme", THEMES.map((t) => t.id), "system"));
    setAccent(read("tb-accent", ACCENTS.map((a) => a.id), "amber"));
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const pickTheme = (t: ThemeId) => {
    setTheme(t);
    apply(t, accent);
    store("tb-theme", t === "system" ? null : t);
  };
  const pickAccent = (a: AccentId) => {
    setAccent(a);
    apply(theme, a);
    store("tb-accent", a === "amber" ? null : a);
  };

  return (
    <div className="theme-menu" ref={root}>
      <button
        type="button"
        className="theme-toggle"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Theme and accent colour"
        title="Theme"
        onClick={() => setOpen(!open)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" />
          <circle cx="7.5" cy="11" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="10.5" cy="7" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="15" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open ? (
        <div className="theme-pop" role="dialog" aria-label="Theme">
          <h2>Theme</h2>
          <div className="theme-grid" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} className="theme-opt" onClick={() => pickTheme(t.id)}>
                <span className="theme-swatch" style={{ background: t.id === "system" ? `linear-gradient(135deg, ${t.swatch[0]} 50%, #0e1116 50%)` : t.swatch[0] }} aria-hidden="true">
                  <i style={{ background: t.swatch[1] }} />
                  <i style={{ background: t.swatch[1] }} />
                  <b />
                </span>
                {t.label}
              </button>
            ))}
          </div>
          <h2>Accent</h2>
          <div className="accent-row" role="radiogroup" aria-label="Accent colour">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={accent === a.id}
                aria-label={a.label}
                title={a.label}
                className="accent-opt"
                style={{ background: a.color }}
                onClick={() => pickAccent(a.id)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
