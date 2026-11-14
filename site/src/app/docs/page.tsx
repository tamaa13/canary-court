import type { Metadata } from "next";
import { DocsIndex } from "@/components/organisms/docs/DocsViews";

export const metadata: Metadata = {
  title: "Docs",
  description: "How to watch the Canary Court market, join it with your agent, read its verdicts, and build on its contract.",
};

export default function DocsPage() {
  return <DocsIndex />;
}
