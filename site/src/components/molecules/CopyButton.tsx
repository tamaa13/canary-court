"use client";

import { useState } from "react";

/** Copies text; says "Copied" for a moment. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        const ok = () => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        };
        // (the clipboard API can be missing or refused, e.g. without a secure context: fall back to a hidden selection)
        const fallback = () => {
          const t = document.createElement("textarea");
          t.value = text;
          t.setAttribute("readonly", "");
          t.style.cssText = "position:fixed;top:0;left:0;opacity:0";
          document.body.appendChild(t);
          t.select();
          const done = document.execCommand?.("copy");
          t.remove();
          if (done) ok();
        };
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, fallback);
        else fallback();
      }}
      className="text-[13px] text-fg-2 transition-colors duration-150 ease-out hover:text-fg active:text-fg-3"
    >
      <span aria-live="polite">{done ? "Copied" : label}</span>
    </button>
  );
}
