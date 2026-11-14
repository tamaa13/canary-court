import type { ReactNode } from "react";

/** The landing's frame: a skip link, the header over the hero, the story (which opens with the hero) and sections in
 *  <main>, the footer. */
export function LandingTemplate({ header, children, footer }: { header: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <>
      <a href="#main" className="sr-only-focusable left-4 top-4 bg-fg px-4 py-3 text-[14px] text-bg">
        Skip to content
      </a>
      {/* the header lies over the top of the story's stage (the hero opens it), and scrolls away with the page */}
      <div data-travel-fade className="absolute inset-x-0 top-0 z-30">
        {header}
      </div>
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      {footer}
    </>
  );
}
