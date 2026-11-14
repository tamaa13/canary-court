import type { ReactNode } from "react";
import { Acct, Near, Usdc, type Env } from "@/components/atoms";
import { KeyValue, StatusLabel, SubHead } from "@/components/molecules";
import type { Snapshot } from "@/lib/market/snapshot";
import { Attestation } from "./Attestation";

/** `attest`: start the attestation checks (only once a fresh live read is on screen: they share the RPC rate limit) */
export function Verified({ s, env, contract, attest = true }: { s: Snapshot; env: Env; contract: string; attest?: boolean }) {
  const c = s.config;
  const p = c.policy;
  const neg = s.solvency?.headroom.startsWith("-");
  const rows: [string, ReactNode][] = [
    ["OutLayer contract", <Acct key="o" id={c.outlayer_id} />],
    ["Enclave code (CodeSource)", JSON.stringify(c.enclave_code)],
    ["Enclave x25519 pubkey", c.enclave_pubkey ? c.enclave_pubkey : <StatusLabel tone="accent">Not configured (set_enclave pending)</StatusLabel>],
    ["Secrets ref (bound to code)", JSON.stringify(c.secrets_ref ?? null)],
    ["Resource limits", JSON.stringify(c.resource_limits ?? null)],
    ["Token", <Acct key="t" id={c.token_id} />],
    [
      "Solvency (get_solvency)",
      s.solvency ? (
        <span className="font-sans text-[14px] leading-relaxed">
          {s.solvency.solvent ? <StatusLabel tone="ok">Solvent</StatusLabel> : <StatusLabel tone="bad">Below reserve</StatusLabel>}{" "}
          <span className="text-fg-2">
            headroom <Near v={neg ? "0" : s.solvency.headroom} /> {neg ? <span className="text-fg">(negative)</span> : null} = balance{" "}
            <Near v={s.solvency.balance} /> − storage <Near v={s.solvency.storage_cost} /> − compute deposits <Near v={s.solvency.compute_liabilities} />; reserve{" "}
            <Near v={s.solvency.reserve} />
          </span>
        </span>
      ) : (
        <span className="text-fg-3">not exposed by this deployment</span>
      ),
    ],
    ["Owner", <Acct key="w" id={c.owner} />],
  ];
  return (
    <section aria-label="What the contract trusts">
      <dl className="border-b border-rule">
        {rows.map(([k, v]) => (
          <KeyValue key={k} k={k}>
            {v}
          </KeyValue>
        ))}
      </dl>

      <Attestation env={env} contract={contract} hasSnapshot={attest} />

      <SubHead>Policy, enforced on chain</SubHead>
      <dl className="border-b border-rule">
        <KeyValue k="Budget and depth">
          <span className="font-sans text-[14px]">
            At most <Usdc v={p.max_budget} /> tUSDC, {p.max_depth + 1} layers of hiring (depth {p.max_depth}), {p.max_children} subjobs per job
          </span>
        </KeyValue>
        <KeyValue k="Counterparty">
          <span className="font-sans text-[14px]">
            Warn if younger than {p.min_age_blocks} blocks or with fewer than {p.min_rep_completed} completed jobs; a Warn agent&apos;s payout is capped at{" "}
            {p.warn_reward_cap_bps / 100}%; blocked after {p.strikes_to_block} strikes
          </span>
        </KeyValue>
        <KeyValue k="Limits">
          <span className="font-sans text-[14px]">
            {p.rate_limit_per_hour} jobs an hour per agent, {p.max_findings_per_job} findings per job, deadlines from {p.min_deadline_ms / 1000}s to{" "}
            {p.max_deadline_ms / 86_400_000} days, a pending run times out after {p.pending_timeout_ms / 60_000} min
          </span>
        </KeyValue>
        <KeyValue k="OutLayer fee / finding">
          <Near v={p.outlayer_fee} />
        </KeyValue>
        <KeyValue k="Allowed categories">{p.allowed_categories.join(", ")}</KeyValue>
      </dl>
    </section>
  );
}
