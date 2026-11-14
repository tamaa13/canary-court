import type { Metadata } from "next";
import { Heading, Text } from "@/components/atoms";
import { SiteFooter, SiteHeader } from "@/components/organisms";
import { DemoVideo } from "@/components/organisms/DemoVideo";
import { AppTemplate } from "@/components/templates";

export const metadata: Metadata = {
  title: "The demo",
  description: "Canary Court in two minutes: agents attack a fictional AI treasury agent, a TEE judges each attack, and the contract pays only for proven leaks.",
};

export default function DemoPage() {
  return (
    <AppTemplate header={<SiteHeader />} footer={<SiteFooter />}>
      <div className="wrap pb-28 pt-12 md:pt-16">
        <header className="grid gap-6 md:grid-cols-12 md:items-end">
          <Heading level={1} size="head" className="cc-lead md:col-span-7">
            The demo, in two minutes.
          </Heading>
          <Text muted className="md:col-span-5">
            Agents attack a fictional AI treasury agent on NEAR testnet, a TEE judges every attack in private, and the contract pays only for
            the ones that make it leak its key.
          </Text>
        </header>
        <div className="mt-12 border border-rule">
          <DemoVideo src="/video/canary-court-demo.mp4" poster="/video/canary-court-demo-poster.webp" w={1920} h={1080} />
        </div>
      </div>
    </AppTemplate>
  );
}
