// What every /app page opens with: one line of title and one of context, or a quiet note while the read is loading.

import type { ReactNode } from "react";
import { Heading, Text } from "@/components/atoms";
import { StatusLabel } from "@/components/molecules";

export function Loading() {
  return (
    <div className="wrap py-16">
      <StatusLabel tone="muted">Loading the market…</StatusLabel>
    </div>
  );
}

export function TabHead({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className="grid gap-4 md:grid-cols-12 md:items-end">
      <Heading level={1} size="title" className="cc-lead font-display text-[clamp(1.9rem,1.3rem+1.6vw,2.6rem)] font-normal leading-[1.02] tracking-[-0.02em] md:col-span-5">
        {title}
      </Heading>
      <Text size="small" muted className="md:col-span-7">
        {children}
      </Text>
    </header>
  );
}
