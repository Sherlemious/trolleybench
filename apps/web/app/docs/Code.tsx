"use client";

import { useState } from "react";

/** A code block with a copy button. The text is the source of truth; nothing is highlighted. */
export default function Code({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the text is still selectable */
    }
  }
  return (
    <div className="code">
      <div className="code-bar">
        <span>{label ?? ""}</span>
        <button type="button" onClick={copy} aria-label="Copy to clipboard">
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}
