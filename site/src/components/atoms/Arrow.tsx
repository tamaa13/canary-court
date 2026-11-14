/** The two arrows the site uses: → (in-page / next) and ↗ (leaves the site). Drawn, so they sit on the text's line. */
export function Arrow({ out = false, className }: { out?: boolean; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 12 12" className={className ?? "inline-block size-[0.72em] shrink-0"} fill="none" stroke="currentColor" strokeWidth="1.4">
      {out ? <path d="M3 9 9 3M4 3h5v5" /> : <path d="M1 6h9.5M7 2.5 10.5 6 7 9.5" />}
    </svg>
  );
}
