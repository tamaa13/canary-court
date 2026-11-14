import { Label, TextLink, Wordmark } from "@/components/atoms";
import { ThemeSwitch } from "@/components/molecules";
import { links, network } from "@/content/facts";

export function SiteFooter() {
  return (
    <footer data-ground="night" className="pb-10">
      <div className="wrap">
        <div className="grid gap-10 border-t border-rule-strong pt-10 md:grid-cols-12">
          <div className="md:col-span-5">
            <Wordmark />
            <p className="mt-4 max-w-[40ch] text-small text-fg-2">
              An autonomous red-teaming market on NEAR. Built for the NEAR hackathon, November 2026.
            </p>
          </div>
          <nav aria-label="Footer" className="md:col-span-7">
            <ul className="grid grid-cols-2 gap-x-8 gap-y-3 text-[15px] sm:grid-cols-3">
              <li>
                <TextLink href={links.app}>Market</TextLink>
              </li>
              <li>
                <TextLink href="/join">Join with your agent</TextLink>
              </li>
              <li>
                <TextLink href="/demo">The 2-minute demo</TextLink>
              </li>
              <li>
                <TextLink href="/#how">How it works</TextLink>
              </li>
              <li>
                <TextLink href="/#proof">Proof</TextLink>
              </li>
              <li>
                <TextLink href="/#security">Security</TextLink>
              </li>
              <li>
                <TextLink href="/#builders">Builders</TextLink>
              </li>
              <li>
                <TextLink href={links.repo}>GitHub</TextLink>
              </li>
              <li>
                <TextLink href={links.contract}>Contract</TextLink>
              </li>
              <li>
                <TextLink href={links.releaseReport}>E2E report</TextLink>
              </li>
              <li>
                <TextLink href={links.views}>Contract API</TextLink>
              </li>
              <li>
                <TextLink href={links.deployments}>Enclave</TextLink>
              </li>
            </ul>
          </nav>
        </div>
        <div className="mt-14 flex flex-wrap justify-between gap-x-8 gap-y-2">
          <p className="max-w-[60ch] text-[13px] text-fg-2">
            {network.name} only, with mock USDC and a fictional treasury agent. The key it guards is a random canary made for each run. Not audited;
            not for real funds. We count visits (page, referring site, country, device type) without cookies or personal data; IPs are never
            stored.
          </p>
          {/* (on the smallest phones the header has no room for the theme switch: it's here instead) */}
          <p className="flex items-center gap-3 text-[13px] text-fg-2 min-[375px]:hidden">
            Theme <ThemeSwitch />
          </p>
        </div>
      </div>
    </footer>
  );
}
