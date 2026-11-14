"use client";
// Proof: how the market defends itself, for anyone who wants to check. Five parts, one at a time (?view= in the URL):
// the attack tests (our own security-test jobs and every scenario's receipt), the counterparty checks, strikes, the
// contract's policy log, and the enclave & model it's pinned to (Verified).
import Link from "next/link";
import { Acct, Hash, Label, Rel, TextButton, TxLink, type Env } from "@/components/atoms";
import { EmptyRow, Pager, StatusLabel, SubHead, Table, Td, Th } from "@/components/molecules";
import { isTestJob, jobPlain, targetInfo } from "@/lib/market/human";
import { ledger, type Snapshot } from "@/lib/market/snapshot";
import { statusTone } from "@/lib/market/status";
import { errCode } from "@/lib/market/types";
import { useFilter, usePager } from "@/lib/pager";
import { Verified } from "./Verified";

const VIEWS = { receipts: "Attack tests", counterparty: "Counterparty checks", strikes: "Strikes", log: "Policy log", enclave: "Enclave & model" } as const;
type View = keyof typeof VIEWS;
const VIEW_KEYS = Object.keys(VIEWS) as View[];

const SCEN: Record<number, string> = {
  1: "Prompt-injected agent tries to move funds: function-call key scope + contract",
  2: "Payload targets the evaluator: a strike, then the blocklist",
  3: "Blocklisted / new agent bids: check_counterparty Block / Warn",
  4: "Runaway lead exceeds subjob or budget caps: contract panics",
  5: "Replay: someone else's sealed target or payload reused in another job: enclave binding check",
};

export function Security({ s, env, contract, attest }: { s: Snapshot; env: Env; contract: string; attest: boolean }) {
  const tests = ledger(s.jobs, s.findings)
    .filter((t) => isTestJob(t.root))
    .sort((a, b) => b.root.id - a.root.id);
  const tp = usePager(tests.length, 10, "tests");
  const escalations = s.policyLog.filter((e) => e.verdict?.level === "Warn" && e.action === "accept_bid");
  const strikes = s.agents.flatMap((a) => a.strikes.map((st) => ({ agent: a, ...st })));
  // (20 to a page each, every list with its own page in the URL)
  const receipts = [...s.receipts].sort((a, b) => Number(a.scenario) - Number(b.scenario));
  const rp = usePager(receipts.length, 20, "receipts");
  const shown = receipts.slice(rp.start, rp.end);
  const byScenario = [1, 2, 3, 4, 5].map((n) => ({ n, rows: shown.filter((r) => Number(r.scenario) === n) })).filter((g) => g.rows.length);
  const vp = usePager(s.agents.length, 20, "verdicts");
  const log = [...s.policyLog].reverse();
  const lp = usePager(log.length, 20, "log");
  // (one part at a time, chosen in the URL: each fits a screen or two)
  const [view, setView] = useFilter<View>("view", VIEW_KEYS, "receipts", "none");
  return (
    <section aria-label="Proof">
      <div role="group" aria-label="Part" className="mt-8 flex flex-wrap gap-x-6 gap-y-2 border-b border-rule-strong pb-3">
        {VIEW_KEYS.map((k) => (
          <TextButton key={k} pressed={view === k} onClick={() => setView(k)}>
            {VIEWS[k]}
          </TextButton>
        ))}
      </div>
      {view === "receipts" && (
        <>
      <SubHead>Our security-test jobs</SubHead>
      <p className="-mt-2 mb-4 max-w-[70ch] text-[14px] text-fg-2">
        Jobs we posted ourselves to attack the market on purpose: the scenarios below, the replay check and release checks. They&apos;re kept out
        of the Market page.
      </p>
      <ul className="border-t border-rule text-[14px]">
        {tests.slice(tp.start, tp.end).map((t) => {
          const p = jobPlain(s, t, env.nowMs);
          return (
            <li key={t.root.id} className="border-b border-rule">
              <Link href={`/app/jobs/${t.root.id}`} className="group rowtint grid gap-x-6 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
                <span className="min-w-0">
                  <span className="glink text-fg">Security test</span> <span className="text-fg-2">({targetInfo(t.root.target_id).about})</span>
                </span>
                <span className="text-fg-2">{p.result ?? p.status}</span>
              </Link>
            </li>
          );
        })}
        {tests.length === 0 && <li className="border-b border-rule py-3 text-fg-2">None in this read.</li>}
      </ul>
      <Pager page={tp.page} pages={tp.pages} go={tp.go} total={tests.length} noun="security-test jobs" />
      <SubHead>Attack scenarios S1–S5, each with its receipt</SubHead>
      <Table caption="Attack scenario receipts" minWidth={1080}>
        <thead>
          <tr>
            <Th>Scenario</Th>
            <Th>Attempt</Th>
            <Th>Signer</Th>
            <Th>Call</Th>
            <Th>Tx</Th>
            <Th>Expected</Th>
            <Th>Observed</Th>
            <Th>Result</Th>
          </tr>
        </thead>
        <tbody>
          {s.receipts.length === 0 && <EmptyRow cols={8}>{env.live ? "No attack receipts bundled in this build." : "No receipts."}</EmptyRow>}
          {byScenario.map(({ n, rows }) =>
            rows.map((r, i) => {
              const on = r.onchain;
              const codes = (r.expected_error ?? "").split("|").map((x) => errCode(x)).filter(Boolean);
              const onchainOk = on && "ok" in on ? (codes.length ? !on.ok && codes.includes(errCode(on.error)) : true) : undefined;
              return (
                <tr key={r.name}>
                  {i === 0 && (
                    <Td rowSpan={rows.length} className="w-[22%] pr-6">
                      <Label className="tabular">
                        S{n}
                      </Label>
                      <p className="mt-1 text-[13.5px] leading-snug text-fg">{rows[0]?.title ?? SCEN[n]}</p>
                    </Td>
                  )}
                  <Td className="whitespace-nowrap font-mono text-[12.5px]">{r.name}</Td>
                  <Td>
                    <Acct id={r.signer} />
                  </Td>
                  <Td className="max-w-[22ch] font-mono text-[12.5px] text-fg-2">
                    <span className="line-clamp-2 break-words" title={r.method}>
                      {r.method}
                    </span>
                  </Td>
                  <Td>
                    <TxLink hash={r.tx_hash} env={env} />
                  </Td>
                  <Td className="max-w-[24ch] font-mono text-[12px] text-fg-2">
                    <span className="line-clamp-2 break-words" title={r.expected_error ?? r.expected ?? ""}>
                      {r.expected_error ?? r.expected ?? "—"}
                    </span>
                  </Td>
                  <Td className="max-w-[26ch] font-mono text-[12px] text-fg-2">
                    <span className="line-clamp-2 break-words" title={(on && "ok" in on ? on.error : null) ?? r.observed_error ?? r.observed ?? ""}>
                      {(on && "ok" in on ? on.error : null) ?? r.observed_error ?? r.observed ?? "—"}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1">
                      {r.ok ? (
                        <StatusLabel tone="ok">{r.expected_error === "strike" ? "Struck" : r.expected_error ? "Blocked" : "Held"}</StatusLabel>
                      ) : (
                        <StatusLabel tone="bad">Not enforced</StatusLabel>
                      )}
                      {onchainOk === true && (
                        <span title="re-checked via RPC tx status">
                          <StatusLabel tone="ok">Verified on chain</StatusLabel>
                        </span>
                      )}
                      {onchainOk === false && <StatusLabel tone="bad">Chain disagrees</StatusLabel>}
                    </div>
                  </Td>
                </tr>
              );
            }),
          )}
        </tbody>
      </Table>
      <Pager page={rp.page} pages={rp.pages} go={rp.go} total={receipts.length} noun="receipts" />
        </>
      )}

      {view === "counterparty" && (
        <>
      <SubHead>check_counterparty verdicts</SubHead>
      <Table caption="Counterparty verdicts per agent" minWidth={1000}>
        <thead>
          <tr>
            <Th>Agent</Th>
            <Th>Role</Th>
            <Th>Verdict</Th>
            <Th>Reasons</Th>
            <Th num>Done</Th>
            <Th num>Invalid</Th>
            <Th num>Failed</Th>
            <Th num>Strikes</Th>
            <Th>Registered</Th>
          </tr>
        </thead>
        <tbody>
          {s.agents.length === 0 && <EmptyRow cols={9}>No agents registered.</EmptyRow>}
          {s.agents.slice(vp.start, vp.end).map((a) => (
            <tr key={a.account_id}>
              <Td>
                <Acct id={a.account_id} />
              </Td>
              <Td className="text-fg-2">{a.role}</Td>
              <Td>
                <div className="flex flex-col gap-1">
                  <StatusLabel tone={statusTone(a.verdict.level)}>{a.verdict.level}</StatusLabel>
                  {a.blocked && <StatusLabel tone="bad">Blocklisted</StatusLabel>}
                </div>
              </Td>
              <Td className="text-[13px] text-fg-2">{a.verdict.reasons.join("; ")}</Td>
              <Td num>{a.completed}</Td>
              <Td num>{a.invalid}</Td>
              <Td num>{a.failed}</Td>
              <Td num>{a.strikes.length}</Td>
              <Td className="whitespace-nowrap">
                <Rel ms={a.registered_ms} now={env.nowMs} /> <span className="tabular font-mono text-[12px] text-fg-3">#{a.registered_block}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pager page={vp.page} pages={vp.pages} go={vp.go} total={s.agents.length} noun="agents" />
        </>
      )}

      {view === "strikes" && (
        <>
      <SubHead>Automatic escalations (a Warn agent hired on restricted terms)</SubHead>
      <ul className="border-t border-rule-strong text-[14px]">
        {escalations.length === 0 && <li className="border-b border-rule py-3 text-fg-2">None yet.</li>}
        {escalations.map((e) => (
          <li key={e.seq} className="flex gap-4 border-b border-rule py-3">
            <span className="tabular w-12 shrink-0 font-mono text-fg-3">#{e.seq}</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-mono">job {e.job_id}</span> {e.detail} <span className="text-fg-2">({e.verdict?.reasons.join("; ")})</span>
            </span>
          </li>
        ))}
      </ul>

      <SubHead>Strikes and blocklist</SubHead>
      <Table caption="Strikes" minWidth={640}>
        <thead>
          <tr>
            <Th>Agent</Th>
            <Th>Finding</Th>
            <Th>Evidence (result_hash)</Th>
            <Th>When</Th>
            <Th>Agent status</Th>
          </tr>
        </thead>
        <tbody>
          {strikes.length === 0 && <EmptyRow cols={5}>No strikes.</EmptyRow>}
          {strikes.map((st) => (
            <tr key={`${st.agent.account_id}-${st.finding_id}`}>
              <Td>
                <Acct id={st.agent.account_id} />
              </Td>
              <Td className="font-mono">{st.finding_id}</Td>
              <Td>
                <Hash v={st.evidence_hash} />
              </Td>
              <Td>
                <Rel ms={st.ts_ms} now={env.nowMs} />
              </Td>
              <Td>
                {st.agent.blocked ? (
                  <StatusLabel tone="bad">Blocked</StatusLabel>
                ) : (
                  <StatusLabel tone="accent">{`${st.agent.strikes.length} strike${st.agent.strikes.length === 1 ? "" : "s"}`}</StatusLabel>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

        </>
      )}

      {view === "log" && (
        <>
      <SubHead>Policy log (non-reverting decisions)</SubHead>
      <Table caption="Policy log" minWidth={900}>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>When</Th>
            <Th>Actor</Th>
            <Th>Action</Th>
            <Th>Job</Th>
            <Th>Verdict</Th>
            <Th>Detail</Th>
          </tr>
        </thead>
        <tbody>
          {s.policyLog.length === 0 && <EmptyRow cols={7}>Empty.</EmptyRow>}
          {log.slice(lp.start, lp.end).map((e) => (
            <tr key={e.seq}>
              <Td className="tabular font-mono text-fg-2">{e.seq}</Td>
              <Td>
                <Rel ms={e.ts_ms} now={env.nowMs} />
              </Td>
              <Td>
                <Acct id={e.actor} />
              </Td>
              <Td className="font-mono text-[12.5px]">{e.action}</Td>
              <Td className="font-mono">{e.job_id ?? "—"}</Td>
              <Td>
                {e.verdict ? (
                  <span title={e.verdict.reasons.join("\n")}>
                    <StatusLabel tone={statusTone(e.verdict.level)}>{e.verdict.level}</StatusLabel>
                  </span>
                ) : (
                  <span className="text-fg-3">—</span>
                )}
              </Td>
              <Td className="text-[13px] text-fg-2">{e.detail}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pager page={lp.page} pages={lp.pages} go={lp.go} total={log.length} noun="entries" />
        </>
      )}
      {view === "enclave" && (
        <div className="mt-8">
          <Verified s={s} env={env} contract={contract} attest={attest} />
        </div>
      )}
    </section>
  );
}
