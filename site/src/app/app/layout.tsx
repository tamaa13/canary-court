import type { ReactNode } from "react";
import { Suspense, ViewTransition } from "react";
import { StatusLabel } from "@/components/molecules";
import { SiteFooter, SiteHeader } from "@/components/organisms";
import { MarketProvider } from "@/components/organisms/market/MarketProvider";
import { MarketShell } from "@/components/organisms/market/MarketShell";
import { AppTemplate } from "@/components/templates";
import { TRAVEL } from "@/lib/travel-type";

/** every /app tab shares one read of the market (kept across tab changes) and one shell */
export default function AppLayout({ children }: { children: ReactNode }) {
  // (arriving on a "travel" navigation the market comes in from a little depth; between its own tabs nothing animates)
  return (
    <ViewTransition
      enter={{ [TRAVEL]: "travel-in", default: "none" }}
      exit="none"
      update="none"
      default="none"
    >
      {/* (one element, so the page is one picture in the transition, and emerges as one after the film's run: .cc-page) */}
      <div className="cc-page">
        <AppTemplate
          header={<SiteHeader current="app" />}
          footer={<SiteFooter />}
        >
          <Suspense
            fallback={
              <div className="wrap py-16">
                <StatusLabel tone="accent">Loading the market…</StatusLabel>
              </div>
            }
          >
            <MarketProvider>
              <MarketShell>{children}</MarketShell>
            </MarketProvider>
          </Suspense>
        </AppTemplate>
      </div>
    </ViewTransition>
  );
}
