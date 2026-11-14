import type { ReactNode } from "react";
import { SearchPalette } from "@/components/organisms/docs/DocsClient";
import { SiteFooter, SiteHeader } from "@/components/organisms";
import { AppTemplate } from "@/components/templates";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <AppTemplate header={<SiteHeader current="docs" />} footer={<SiteFooter />}>
      {children}
      <SearchPalette />
    </AppTemplate>
  );
}
