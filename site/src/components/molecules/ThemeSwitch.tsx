"use client";
// The header's theme switch: one small button (a half-filled circle), no pill. The page starts in the visitor's last
// choice or the system's (layout.tsx sets <html data-theme> before paint); a click flips it and remembers the choice,
// unless the choice is what the system says anyway, in which case the page goes back to following the system.

import { useEffect, useState } from "react";

const KEY = "cc-theme";
type Theme = "light" | "dark";

const systemTheme = (): Theme => (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

export function ThemeSwitch() {
  // (null until mounted: the server can't know the theme)
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    // following the system: keep following it when it changes
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(KEY);
      } catch {
        /* storage blocked: follow the system */
      }
      if (stored === "light" || stored === "dark") return;
      const t = systemTheme();
      root.dataset.theme = t;
      setTheme(t);
    };
    mq.addEventListener("change", onSystem);
    return () => mq.removeEventListener("change", onSystem);
  }, []);

  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        setTheme(next);
        try {
          if (next === systemTheme()) localStorage.removeItem(KEY);
          else localStorage.setItem(KEY, next);
        } catch {
          /* storage blocked: the switch still works for this page */
        }
      }}
      aria-label={theme ? `Switch to the ${next} theme` : "Switch the theme"}
      title={theme ? `Switch to the ${next} theme` : undefined}
      className="-m-2 grid place-items-center p-2 text-fg-2 transition-colors duration-150 ease-out hover:text-fg active:text-fg-3"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-[15px]">
        <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 1.6a6.4 6.4 0 0 1 0 12.8z" fill="currentColor" />
      </svg>
    </button>
  );
}
