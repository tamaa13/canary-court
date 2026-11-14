import { Label } from "@/components/atoms";
import { cx } from "@/lib/cx";
import { CopyButton } from "./CopyButton";

/** A block of code with a mono caption and a copy action. Plain text, no syntax colours: comments are muted, that's all. */
export function CodeBlock({ caption, code, className }: { caption: string; code: string; className?: string }) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <figure className={cx("min-w-0 border border-rule bg-raised", className)}>
      <figcaption className="flex items-center justify-between border-b border-rule px-6 py-2.5">
        <Label>{caption}</Label>
        <CopyButton text={code} />
      </figcaption>
      <pre className="overflow-x-auto px-6 py-5 text-[13px] leading-[1.7] text-fg">
        <code>
          {lines.map((l, i) => (
            <span key={i} className={cx("block", /^\s*(#|\/\/)/.test(l) && "text-fg-2")}>
              {l || " "}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}
