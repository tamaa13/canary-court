import { SectionHead, FaqItem } from "@/components/molecules";
import { policy } from "@/content/facts";

export function Faq() {
  return (
    <section id="faq" data-ground="paper" aria-labelledby="faq-title" className="section-y">
      <div className="wrap grid gap-12 md:grid-cols-12">
        <div className="md:col-span-4">
          <SectionHead id="faq-title" title="Fair questions." />
        </div>
        <div className="border-t border-rule-strong md:col-span-8 md:mt-0">
          <FaqItem q="Is any of this real money, or a real treasury?">
            <p>
              No. Everything runs on NEAR testnet with a mock USDC token. The treasury agent, its tools and its invoices are
              fictional, and its &ldquo;withdrawal approval key&rdquo; is a random canary generated for each run.
            </p>
          </FaqItem>
          <FaqItem q="Who decides whether an attack worked?">
            <p>
              Not us, and not an LLM&apos;s opinion. The enclave runs in OutLayer&apos;s TEE; its build hash is pinned on chain and its key
              only works for that build. It sends the attack to the treasury agent on a NEAR AI model (also in a TEE, temperature 0,
              signed responses) and checks the reply for the canary. The contract pays on that attested verdict.
            </p>
          </FaqItem>
          <FaqItem q="What if the TEE run times out?">
            <p>
              The attacker gets their fee back minus OutLayer&apos;s maximum charge ({policy.infraRefund.value}), with no strike and
              nothing counted against them, and can resubmit. If NEAR AI itself is down, the run did execute, so the fee is kept, but
              there&apos;s still no strike.
            </p>
          </FaqItem>
          <FaqItem q="Can the owner take the attack and not pay?">
            <p>
              No. The owner can&apos;t read an attack until it has been judged a leak, and a valid finding&apos;s sealed report and its
              payout land in the same callback. A valid finding goes unpaid only if it repeats one already paid in that job or the budget
              has run out; both cases are flagged unpaid on chain.
            </p>
          </FaqItem>
          <FaqItem q="Can a hijacked agent drain the market?">
            <p>
              Not out of the market. Agents sign market calls with a function-call key: it can&apos;t send tokens or NEAR, attach
              deposits or add keys, so a hijacked agent can&apos;t move funds out of the market. Inside it, the agent can still spend its
              own escrow (post a job, hire someone), within the contract&apos;s limits, and the full-access setup key stored on its machine
              must stay out of the agent&apos;s reach.
            </p>
          </FaqItem>
          <FaqItem q="Can a tricked agent move real money?">
            <p>
              No. During a test your agent runs as a copy inside the enclave and its payment tools are simulated, so nothing leaves
              your wallet. A test counts as a win when the agent gives away its secret key, even inside a payment. A payment that
              never exposes the key, like a small invoice to the wrong vendor, isn&apos;t scored yet; rules such as &ldquo;only pay
              these vendors&rdquo; are next.
            </p>
          </FaqItem>
          <FaqItem q="What doesn't it cover?">
            <p>
              &ldquo;Valid&rdquo; means the key leaked: a clean, checkable test for secret exfiltration, but not every harm (an unsafe
              tool call with no secret in it wouldn&apos;t count). Grader-manipulation detection is rule-based, reputation is simple
              counts, and there is no appeal flow yet.
            </p>
          </FaqItem>
        </div>
      </div>
    </section>
  );
}
