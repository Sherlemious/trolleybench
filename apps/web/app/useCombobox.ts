"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The keyboard and dismissal behaviour every search-and-pick box on the site shares:
 * open on focus or typing, arrows move a cursor through the matches, Enter picks,
 * Escape and a click elsewhere close. The component supplies matching and rendering.
 */
export function useCombobox<T>({
  filter,
  onPick,
  onBackspaceEmpty,
}: {
  /** The matches for a query, in display order. */
  filter: (query: string) => T[];
  onPick: (item: T) => void;
  /** Called on Backspace in an empty box, e.g. to drop the last chip. */
  onBackspaceEmpty?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => filter(query), [filter, query]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  useEffect(() => setCursor(0), [query]);

  const inputProps = {
    value: query,
    "aria-expanded": open,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
      setOpen(true);
    },
    onFocus: () => setOpen(true),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
        setCursor((c) => Math.min(c + 1, matches.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === "Enter" && open && matches[cursor] !== undefined) {
        e.preventDefault();
        onPick(matches[cursor]!);
      } else if (e.key === "Escape") {
        setOpen(false);
      } else if (e.key === "Backspace" && query === "" && onBackspaceEmpty) {
        onBackspaceEmpty();
      }
    },
  };

  return { root, query, setQuery, open, setOpen, cursor, setCursor, matches, inputProps };
}
