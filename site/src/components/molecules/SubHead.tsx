import type { ReactNode } from "react";

/** a sub-heading inside a page or panel */
export function SubHead({ children }: { children: ReactNode }) {
  return <h3 className="mb-4 mt-12 text-[17px] font-medium tracking-[-0.015em] text-fg">{children}</h3>;
}
