import { Arrow, Label, TextButton } from "@/components/atoms";

/** "Page 2 of 7" and Prev / Next. With one page, just the count. */
export function Pager({ page, pages, go, total, noun }: { page: number; pages: number; go: (p: number) => void; total: number; noun: string }) {
  if (pages <= 1) return <Label as="p" className="mt-4 tabular">{`${total} ${noun}`}</Label>;
  return (
    <nav aria-label={`${noun} pages`} className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <Label className="tabular">{`Page ${page} of ${pages}, ${total} ${noun}`}</Label>
      <div className="flex items-center gap-6">
        <TextButton onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <span className="nudge-back inline-flex"><Arrow className="inline-block size-[10px] rotate-180" /></span> Prev
        </TextButton>
        <TextButton onClick={() => go(page + 1)} disabled={page >= pages} aria-label="Next page">
          Next <Arrow className="nudge inline-block size-[10px]" />
        </TextButton>
      </div>
    </nav>
  );
}
