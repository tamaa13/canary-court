import type { ReactNode } from "react";

/** The app's frame: the same header and footer as the landing, a working surface on paper between them. */
export function AppTemplate({ header, children, footer }: { header: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <>
      <a href="#main" className="sr-only-focusable left-4 top-4 bg-fg px-4 py-3 text-[14px] text-bg">
        Skip to content
      </a>
      <div data-ground="paper" className="border-b border-rule">
        {header}
      </div>
      {/* (a full screen at least: while the market loads, the footer stays below the fold, so nothing jumps when it lands) */}
      <main id="main" tabIndex={-1} data-ground="paper" className="min-h-svh outline-none">
        {children}
      </main>
      {footer}
    </>
  );
}
