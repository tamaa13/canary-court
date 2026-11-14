import type { ComponentProps } from "react";
import { cx } from "@/lib/cx";

/** A quiet action inside a panel (re-check, new nonce, step): words on a hairline, never a filled pill. `pressed` marks
 *  the chosen option of a switch with a solid ink rule. */
export function TextButton({ className, pressed, ...rest }: ComponentProps<"button"> & { pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cx(
        "group inline-flex items-center gap-2 border-b pb-0.5 text-[14px] font-medium tracking-[-0.005em] transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40",
        pressed === undefined
          ? "border-rule-strong text-fg enabled:hover:border-fg enabled:active:text-fg-2"
          : pressed
            ? "border-fg text-fg [border-bottom-width:2px] pb-px"
            : "border-transparent text-fg-2 hover:text-fg",
        className,
      )}
      {...rest}
    />
  );
}
