import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cx } from "@/lib/cx";

/** A data table on hairlines: mono heads, tabular numbers right-aligned, scrolls sideways inside its own box on a phone. */
export function Table({ caption, children, minWidth = 720, className }: { caption: string; children: ReactNode; minWidth?: number; className?: string }) {
  return (
    <div className={cx("overflow-x-auto [scrollbar-width:thin]", className)} role="region" aria-label={caption} tabIndex={0}>
      <table className="w-full border-collapse text-left text-[14px] leading-snug" style={{ minWidth }}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({ num, className, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  return (
    <th
      scope="col"
      className={cx(
        "whitespace-nowrap border-b border-rule-strong pb-2.5 pr-5 align-bottom font-mono text-label font-normal uppercase text-fg-2 last:pr-0",
        num && "text-right",
        className,
      )}
      {...rest}
    />
  );
}

export function Td({ num, className, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  return <td className={cx("border-b border-rule py-3 pr-5 align-top text-fg last:pr-0", num && "tabular text-right", className)} {...rest} />;
}

export function EmptyRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="border-b border-rule py-5 text-fg-2">
        {children}
      </td>
    </tr>
  );
}
