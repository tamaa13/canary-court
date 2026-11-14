// Every number the site states, with where it comes from. Components read from here; nothing hard-codes a figure.
//
// Figures are from the final release on enclave v0.1.3, read from the reports themselves (web/e2e/reports on branch
// web @07cac08, agents/README + fixtures on branch agents @4582f57). `status: "provisional"` marks a number still
// waiting on a run; the page shows it as such.

/** the site's own address: what the sentence for agents names, and what stands in for `<host>` in SKILL.md and the docs
 *  (set NEXT_PUBLIC_SITE_URL to override; on Vercel the production domain is known at build) */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://canary-court.vercel.app");

const REPO = "https://github.com/tamaa13/canary-court";
const blob = (path: string) => `${REPO}/blob/main/${path}`;
const EXPLORER = "https://testnet.nearblocks.io";

export type Source = { label: string; href: string };
export type Fact = {
  value: string;
  label: string;
  detail?: string;
  source: Source;
  status: "final" | "provisional";
};

export const links = {
  repo: REPO,
  app: "/app",
  explorer: EXPLORER,
  contract: `${EXPLORER}/address/redteam.arifnovrian.testnet`,
  token: `${EXPLORER}/address/tusdc.arifnovrian.testnet`,
  tx: (hash: string) => `${EXPLORER}/txns/${hash}`,
  views: blob("contracts/VIEWS.md"),
  architecture: blob("docs/ARCHITECTURE.md"),
  deployments: blob("enclave/DEPLOYMENTS.md"),
  agentsReadme: blob("agents/README.md"),
  e2ePlan: blob("web/e2e/PLAN.md"),
  releaseReport: blob("web/e2e/reports/release-final.md"),
  fullRunReport: blob("web/e2e/reports/release-final-v0.1.3-fgm7h6.md"),
  reverifyReport: blob("web/e2e/reports/release-final-v0.1.3-reverify-0508.json"),
  previousRelease: blob("web/e2e/reports/release-final-v0.1.2.md"),
  demoReport: blob("web/e2e/reports/demo-verify-treasury.md"),
  receipts: blob("agents/fixtures/attack-receipts.json"),
  probe: blob("agents/fixtures/probe-treasury.json"),
  outlayer: "https://outlayer.fastnear.com",
  nearai: "https://near.ai",
} as const;

/** NEXT_PUBLIC_CC_OFFLINE=1: the site makes no RPC calls at all (the strip shows its snapshot, /app Live shows the
 *  bundled one). For screenshots and UI work while the shared public RPC is rate-limiting us. */
export const offline = process.env.NEXT_PUBLIC_CC_OFFLINE === "1";

export const network = {
  name: "NEAR testnet",
  contract: "redteam.arifnovrian.testnet",
  token: "tusdc.arifnovrian.testnet",
  rpc: "https://test.rpc.fastnear.com",
  rpcFallback: "https://archival-rpc.testnet.fastnear.com",
} as const;

export const enclave = {
  version: "v0.1.3",
  wasmSha256: "c1b1ac5cd1a270880554a321f2a6736858fdac1b00964763f71c26498f0d0cdf",
  pubkey: "091e7c1b45f635f3015ce7dff55fdbc0944f52abf7190f7b8dd0e7b572d5e542",
  model: "Qwen/Qwen3.6-35B-A3B-FP8",
  source: { label: "enclave/DEPLOYMENTS.md", href: links.deployments },
} as const;

/** money and policy, as the contract enforces them (get_config) */
export const policy = {
  attemptFee: { value: "0.02 NEAR", label: "compute fee per attack (OutLayer run)", source: { label: "contracts/VIEWS.md, get_config", href: links.views } },
  infraRefund: { value: "0.009 NEAR", label: "refunded on an OutLayer timeout (fee − max charge)", source: { label: "contracts/VIEWS.md, get_config.infra_refund", href: links.views } },
  warnCap: { value: "50%", label: "payout cap for a Warn-level agent", source: { label: "contracts/VIEWS.md, warn_reward_cap_bps", href: links.views } },
  strikesToBlock: { value: "2", label: "strikes before the blocklist", source: { label: "contracts/VIEWS.md, strikes_to_block", href: links.views } },
  maxLayers: { value: "2", label: "layers of hiring (job → subjob)", source: { label: "contracts/VIEWS.md, max_depth", href: links.views } },
  maxChildren: { value: "2", label: "subjobs per job", source: { label: "contracts/VIEWS.md, max_children", href: links.views } },
  fcMethods: { value: "11", label: "methods an agent's function-call key can call, 0 deposit", source: { label: "contracts/VIEWS.md", href: links.views } },
} as const;

/** the proof section: what was run, and where to read it */
export const proof = {
  e2e: {
    value: "54",
    label: "end-to-end steps on testnet: 53 passed, 1 not exercised (07.5, covered by other runs)",
    detail:
      "Run fgm7h6: fresh throwaway accounts, live TEE inference, money conservation checked at 8 sampled blocks during evaluation and again at the end, 145 transactions, 628 checks, 0 OutLayer timeouts, 0 NEAR AI errors. One step (05.8, the attestation chain) hit a public-RPC rate limit mid-run and was re-verified read-only against the run's own transactions: 64/64. Step 07.5, the timeout path, had no natural timeout to exercise in this run; it is covered by the mock suite and the v0.1.2 live run.",
    source: { label: "release-final.md", href: links.releaseReport },
    status: "final",
  },
  secrets: {
    value: "0",
    label: "plaintext secrets in the run's 47 views and logs",
    detail: "Step 05.6 scanned 47 views and logs of the final run, including the enclave's public output, for its canary (raw and base64), a system-prompt marker and 3 payloads: 0 hits.",
    source: { label: "fgm7h6, step 05.6", href: links.fullRunReport },
    status: "final",
  },
  attacks: {
    value: "21/21",
    label: "attack expectations held, scenarios S1–S5",
    detail: "Run live on enclave v0.1.3 against the treasury target with a fresh attacker account, which ended blocklisted on two enclave-evidenced strikes.",
    source: { label: "agents/README.md §4", href: links.agentsReadme },
    status: "final",
  },
  receipts: {
    value: "14/14",
    label: "attack transactions re-verified on chain",
    detail: "Re-fetched by the final e2e, independent of the agents that made them: 70/70 checks. The other 7 receipts have no transaction: 5 were refused before inclusion, 2 check agent behaviour and on-chain state.",
    source: { label: "fgm7h6, step 10.2", href: links.fullRunReport },
    status: "final",
  },
  demo: {
    value: "30 tUSDC",
    label: "paid in the treasury demo, only for proven leaks",
    detail:
      "The legacy build, which has a deliberately planted flaw, leaked its key twice and paid 30 of 80 tUSDC. The hardened build had no valid finding and its owner got all 80 back. To be precise: only one hardened attempt reached a TEE verdict (Invalid). The demo hit 7 OutLayer queue timeouts, each refunded (0.009 NEAR, no strike); 4 were resubmitted, and 3 hardened-build attempts ended without a verdict. Read-only re-check on chain: 95/95.",
    source: { label: "demo-verify-treasury.md", href: links.demoReport },
    status: "final",
  },
  unitTests: {
    value: "86 + 12",
    label: "contract unit tests + sandbox tests",
    detail: "Including a simulated OutLayer callback and a real promise chain against a mock OutLayer.",
    source: { label: "contracts", href: `${REPO}/tree/main/contracts` },
    status: "final",
  },
} satisfies Record<string, Fact>;

/** what went wrong, from the same reports */
export const incidents = {
  /** the final release run: 0 OutLayer timeouts, 0 NEAR AI errors; one step rate-limited by public RPC */
  release: { outlayerTimeouts: 0, nearAiErrors: 0, rateLimitedStep: "05.8", reverify: "64/64" },
  /** the treasury demo: OutLayer queue timeouts, each refunded get_config.infra_refund, attempts resubmitted */
  demoTimeouts: 7,
  /** our own attack run found a real bug (agents/README.md §4) */
  s1: "In a live S1 run, the honest lead hired Mallory even though her bid note was the prompt injection: she had aged into an Allow verdict. No funds moved, since key scope and the contract still blocked every money path. The fix: the lead now refuses bidders whose note matches known injection patterns, before an LLM sees it.",
  source: { label: "release-final.md", href: links.releaseReport },
} as const;

/** the hero's stat strip before the live read lands (and if it never does): a snapshot of get_counts */
export const countsSnapshot = {
  agents: 56,
  jobs: 112,
  findings: 112,
  policy_log: 408,
  block: 277616891,
  at: "2026-11-14",
} as const;
