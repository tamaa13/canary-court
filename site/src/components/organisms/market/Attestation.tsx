"use client";
// The attestation checks: rt-enclave's verifier (enclave/verify/verify.mjs) run in this browser against public sources
// only (NEAR RPC, nearblocks, FastFS, NEAR AI Cloud). Nothing is trusted from this page's own code. Ported from
// web/src/verified/AttestationPanel.tsx; same checks, same order, same rate-limit courtesy.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { TESTNET, verifyEnclave, verifyFinding, verifyModelAttestation, type Check, type Result } from "@enclave/verify";
import { Acct, Text, TextButton, TxLink, type Env } from "@/components/atoms";
import { StatusLabel, SubHead } from "@/components/molecules";

const NEARBLOCKS_API = "https://api-testnet.nearblocks.io/v1";
const DEFAULT_MODEL = "Qwen/Qwen3.6-35B-A3B-FP8";

interface SubmitTx {
  hash: string;
  signer: string;
  ts: number;
  ok: boolean;
}

type Run<T> = { state: "idle" } | { state: "running" } | { state: "done"; result: T } | { state: "error"; message: string };

function Checks({ checks }: { checks: Check[] }) {
  return (
    <ul className="border-t border-rule-strong">
      {checks.map((c) => (
        <li key={c.id} className="grid gap-x-6 gap-y-1 border-b border-rule py-3 text-[14px] sm:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1.2fr)]">
          <span>
            {c.ok === true ? <StatusLabel tone="ok">Pass</StatusLabel> : c.ok === false ? <StatusLabel tone="bad">Fail</StatusLabel> : <StatusLabel tone="muted">n/a</StatusLabel>}
          </span>
          <span className="text-fg">{c.label}</span>
          <span className="break-words font-mono text-[12px] text-fg-2">{c.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function Status<T extends Result>({ run, children }: { run: Run<T>; children?: (r: T) => ReactNode }) {
  if (run.state === "idle") return null;
  if (run.state === "running") return <StatusLabel tone="accent">Checking…</StatusLabel>;
  if (run.state === "error") return <StatusLabel tone="bad">{`Verifier error: ${run.message}`}</StatusLabel>;
  return (
    <>
      <Checks checks={run.result.checks} />
      {children?.(run.result)}
    </>
  );
}

async function recentSubmits(contract: string): Promise<SubmitTx[]> {
  const r = await fetch(`${NEARBLOCKS_API}/account/${contract}/txns-only?method=submit_finding&per_page=25`, { headers: { Accept: "application/json" } });
  const d = (await r.json()) as {
    txns?: { transaction_hash: string; signer_account_id: string; block_timestamp: string; outcomes?: { status?: boolean }; actions?: { method?: string }[] }[];
  };
  // the indexer's method filter is not reliable, so keep only real submit_finding calls
  return (d.txns ?? [])
    .filter((t) => t.actions?.some((a) => a.method === "submit_finding"))
    .map((t) => ({ hash: t.transaction_hash, signer: t.signer_account_id, ts: Number(BigInt(t.block_timestamp) / 1_000_000n), ok: t.outcomes?.status !== false }));
}

export function Attestation({ env, contract, hasSnapshot = true }: { env: Env; contract: string; hasSnapshot?: boolean }) {
  const [enclave, setEnclave] = useState<Run<Result>>({ state: "idle" });
  const [txs, setTxs] = useState<SubmitTx[] | null>(null);
  const [picked, setPicked] = useState<SubmitTx | null>(null);
  const [finding, setFinding] = useState<Run<Awaited<ReturnType<typeof verifyFinding>>>>({ state: "idle" });
  const [model, setModel] = useState<Run<Awaited<ReturnType<typeof verifyModelAttestation>>>>({ state: "idle" });

  const runEnclave = useCallback(async () => {
    setEnclave({ state: "running" });
    try {
      setEnclave({ state: "done", result: await verifyEnclave(TESTNET) });
    } catch (e) {
      setEnclave({ state: "error", message: (e as Error).message });
    }
  }, []);

  const runModel = useCallback(async (modelId: string, signer?: string) => {
    setModel({ state: "running" });
    try {
      setModel({ state: "done", result: await verifyModelAttestation(TESTNET, modelId, signer) });
    } catch (e) {
      setModel({ state: "error", message: (e as Error).message });
    }
  }, []);

  const runFinding = useCallback(
    async (tx: SubmitTx) => {
      setPicked(tx);
      setFinding({ state: "running" });
      setModel({ state: "idle" });
      try {
        const r = await verifyFinding(TESTNET, tx.hash, tx.signer);
        setFinding({ state: "done", result: r });
        const sig = r.output?.model_signatures?.[0];
        if (r.output?.llm === "live" && r.output.model && sig) runModel(r.output.model, sig.signing_address);
      } catch (e) {
        setFinding({ state: "error", message: (e as Error).message });
      }
    },
    [runModel],
  );

  // don't compete with the first live load for the per-IP RPC rate limit: start once a snapshot is on screen
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!env.live || !hasSnapshot) return;
    const t = setTimeout(() => setReady(true), 3000);
    return () => clearTimeout(t);
  }, [env.live, hasSnapshot]);

  useEffect(() => {
    if (!env.live || !ready) return;
    runEnclave();
    recentSubmits(contract)
      .then((list) => {
        setTxs(list);
        const first = list.find((t) => t.ok);
        if (first) runFinding(first);
      })
      .catch(() => setTxs([]));
  }, [env.live, ready, contract, runEnclave, runFinding]);

  if (!env.live)
    return (
      <Text size="small" muted className="mt-10 border-t border-rule-strong pt-4">
        Switch to <span className="font-medium text-fg">Live testnet</span> to run the attestation checks. They run in your browser against public
        sources (NEAR RPC, nearblocks, FastFS, NEAR AI Cloud). The demo has no TEE, so there is nothing to attest.
      </Text>
    );
  if (!ready)
    return (
      <div className="mt-10">
        <StatusLabel tone="muted">Attestation checks start a few seconds after the live state loads (they share the public RPC rate limit)</StatusLabel>
      </div>
    );

  const findingModel = finding.state === "done" ? finding.result.output?.model : undefined;
  const findingSigner = finding.state === "done" ? finding.result.output?.model_signatures?.[0]?.signing_address : undefined;

  return (
    <div>
      <SubHead>
        <span className="flex flex-wrap items-baseline justify-between gap-4">
          Enclave code and key custody <TextButton onClick={runEnclave}>Re-check</TextButton>
        </span>
      </SubHead>
      <Text size="small" muted className="mb-5">
        The contract pins the enclave build, the hosted wasm hashes to that pin, and the enclave&apos;s private key can only be read by that exact
        build, only when called through the escrow contract.
      </Text>
      <Status run={enclave} />

      <SubHead>One evaluation, end to end</SubHead>
      <Text size="small" muted className="mb-5">
        Pick a <code className="font-mono text-[0.9em] text-fg">submit_finding</code> transaction. The checks: OutLayer ran the pinned build at the
        contract&apos;s request, a TDX-attested worker key posted the result, and for live findings, NEAR AI signed every model response.
      </Text>
      {txs === null && <StatusLabel tone="accent">Loading recent submissions from nearblocks…</StatusLabel>}
      {txs && txs.length === 0 && <StatusLabel tone="muted">No submit_finding transactions found yet</StatusLabel>}
      {txs && txs.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3 text-[14px]">
          <label className="sr-only" htmlFor="finding-tx">
            submit_finding transaction
          </label>
          <select
            id="finding-tx"
            value={picked?.hash ?? ""}
            onChange={(e) => {
              const t = txs.find((x) => x.hash === e.target.value);
              if (t) runFinding(t);
            }}
            className="max-w-full border-b border-rule-strong bg-transparent py-1.5 pr-6 font-mono text-[13px] text-fg"
          >
            {txs.map((t) => (
              <option key={t.hash} value={t.hash}>
                {new Date(t.ts).toLocaleString()}, {t.signer.replace(/\.arifnovrian\.testnet$/, "")}, {t.hash.slice(0, 10)}…{t.ok ? "" : " (failed tx)"}
              </option>
            ))}
          </select>
          {picked && (
            <span className="text-fg-2">
              <TxLink hash={picked.hash} env={env} label="open tx" /> by <Acct id={picked.signer} />
            </span>
          )}
        </div>
      )}
      <Status run={finding}>
        {(r) =>
          r.output ? (
            <p className="mt-4 text-[14px] text-fg-2">
              Enclave output: valid <span className="font-mono text-fg">{String(r.output.valid)}</span>, severity{" "}
              <span className="font-mono text-fg">{r.output.severity}</span>, llm <span className="font-mono text-fg">{r.output.llm}</span>
              {r.output.dedup_key && (
                <>
                  {" "}
                  , dedup_key <span className="font-mono">{r.output.dedup_key.slice(0, 12)}…</span>
                </>
              )}
              {(r.output.warnings ?? []).length > 0 && <>; warnings: {r.output.warnings!.join(", ")} (that recipient&apos;s report is null; the verdict stands)</>}
              {r.output.llm === "mock" && <> (mock target: no model was called, so there is nothing to attest for the model)</>}
            </p>
          ) : null
        }
      </Status>

      <SubHead>
        <span className="flex flex-wrap items-baseline justify-between gap-4">
          NEAR AI model TEE: fresh-nonce attestation
          <TextButton onClick={() => runModel(findingModel ?? DEFAULT_MODEL, findingSigner)}>New nonce</TextButton>
        </span>
      </SubHead>
      <Text size="small" muted className="mb-5">
        Asks NEAR AI Cloud for an attestation report bound to a random nonce generated in this browser. The Intel TDX quote must carry the signing
        key and the nonce; the NVIDIA GPU evidence must echo the nonce. With a live finding selected, the attested key must be the one that signed
        its responses.
      </Text>
      {model.state === "idle" && <StatusLabel tone="muted">{`Select a live finding, or press New nonce to attest ${DEFAULT_MODEL}`}</StatusLabel>}
      <Status run={model}>{(r) => (r.nonce ? <p className="mt-3 break-all font-mono text-[12px] text-fg-2">nonce {r.nonce}</p> : null)}</Status>

      <SubHead>What this does not prove</SubHead>
      <ul className="border-t border-rule-strong text-[14px] text-fg-2">
        {[
          "That OutLayer's coordinator delivered the request faithfully. It cannot forge results, but it queues requests.",
          "The Intel and NVIDIA signature chains behind the quotes. Those need an external verifier (DCAP / NRAS) and are shown as n/a.",
          "Anything about the model for mock-target findings. Those never call a model.",
          "That TEEs are unbreakable. This is attestation, not a cryptographic proof of correct execution.",
        ].map((t) => (
          <li key={t} className="border-b border-rule py-3">
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}
