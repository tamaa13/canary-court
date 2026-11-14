import type { ReactNode } from "react";

/** One question: native disclosure (keyboard and screen readers for free), a hairline between items, a +/− mark. */
export function FaqItem({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group border-b border-rule [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-6 text-title font-medium text-fg">
        <span className="slink max-w-[36ch]">{q}</span>
        <span aria-hidden className="relative mt-[0.45em] size-3.5 shrink-0">
          <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-fg" />
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-fg transition-transform duration-[180ms] ease-out group-open:scale-y-0" />
        </span>
      </summary>
      <div className="max-w-[62ch] pb-8 text-body text-fg-2 [&_p+p]:mt-3">{children}</div>
    </details>
  );
}
