import type { ReactNode } from "react";
import { Heading, Rule, Text } from "@/components/atoms";
import { cx } from "@/lib/cx";

/** A section's opening: a strong hairline, then the headline standing on its own, and an optional lede. */
export function SectionHead({ title, lede, id, className }: { title: ReactNode; lede?: ReactNode; id: string; className?: string }) {
  return (
    <header className={cx("flex flex-col", className)}>
      <Rule strong />
      <Heading level={2} size="head" id={id} className="mt-10 max-w-[9.5em] md:mt-14">
        {title}
      </Heading>
      {lede ? (
        <Text size="lede" muted className="mt-6 max-w-[52ch]">
          {lede}
        </Text>
      ) : null}
    </header>
  );
}
