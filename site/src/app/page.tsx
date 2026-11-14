import {
  Builders,
  Close,
  Faq,
  Hero,
  HowItWorks,
  Privacy,
  Proof,
  Defenses,
  SiteFooter,
  SiteHeader,
  VaultStory,
} from "@/components/organisms";
import { ViewTransition } from "react";
import { LandingTemplate } from "@/components/templates";
import { TRAVEL } from "@/lib/travel-type";

/** the live stat strip's server read is at most a minute old */
export const revalidate = 60;

export default function LandingPage() {
  // (leaving on a "travel" navigation, the page's last picture fades out: lib/travel.ts)
  return (
    <ViewTransition
      exit={{ [TRAVEL]: "travel-out", default: "none" }}
      enter="none"
      update="none"
      default="none"
    >
      {/* (one element, so the page is one picture in the transition, and emerges as one after the film's run: .cc-page) */}
      <div className="cc-page" data-route="landing">
        <LandingTemplate header={<SiteHeader />} footer={<SiteFooter />}>
          <VaultStory hero={<Hero />} />
          <HowItWorks />
          <Proof />
          <Defenses />
          <Privacy />
          <Builders />
          <Faq />
          <Close />
        </LandingTemplate>
      </div>
    </ViewTransition>
  );
}
