// Chain values as the app shows them: accounts, transactions, hashes, amounts, times. Live mode links to the explorer;
// demo mode's hashes are synthetic, so they never link anywhere.

import { fmtNear, fmtUsdc } from "@/lib/market/amount";
import { accountUrl, txUrl } from "@/lib/near";
import { cx } from "@/lib/cx";

export interface Env {
  live: boolean;
  nowMs: number;
}

const SUFFIX = /\.arifnovrian\.testnet$/;
const mono = "font-mono text-[0.92em] tracking-[-0.01em]";
const link = "ulink";

export function Acct({ id }: { id: string | null | undefined }) {
  if (!id) return <span className="text-fg-3">—</span>;
  return (
    <a className={cx(mono, link, "whitespace-nowrap")} href={accountUrl(id)} rel="noreferrer" title={id}>
      {id.replace(SUFFIX, "")}
    </a>
  );
}

export function TxLink({ hash, env, label }: { hash: string | null | undefined; env: Env; label?: string }) {
  if (!hash)
    return (
      <span className={cx(mono, "text-fg-3")} title="rejected before inclusion, so there is no transaction">
        no tx
      </span>
    );
  const text = label ?? `${hash.slice(0, 8)}…`;
  if (!env.live)
    return (
      <span className={cx(mono, "text-fg-3")} title={`${hash} (demo hash, not on chain)`}>
        {text}
      </span>
    );
  return (
    <a className={cx(mono, link)} href={txUrl(hash)} rel="noreferrer" title={hash}>
      {text}
    </a>
  );
}

export function Hash({ v }: { v: string | null | undefined }) {
  if (!v) return <span className="text-fg-3">—</span>;
  return (
    <span className={cx(mono, "text-fg-2")} title={v}>
      {v.slice(0, 10)}…
    </span>
  );
}

export const Usdc = ({ v }: { v: string | bigint | null | undefined }) => <span className="tabular">{fmtUsdc(v)}</span>;
export const Near = ({ v }: { v: string | bigint | null | undefined }) => <span className="tabular">{fmtNear(v)} NEAR</span>;

export function Rel({ ms, now }: { ms: number | null | undefined; now: number }) {
  if (!ms) return <span className="text-fg-3">—</span>;
  const d = ms - now;
  const a = Math.abs(d);
  const txt =
    a < 60_000 ? `${Math.round(a / 1000)}s` : a < 3_600_000 ? `${Math.round(a / 60_000)}m` : a < 86_400_000 ? `${(a / 3_600_000).toFixed(1)}h` : `${(a / 86_400_000).toFixed(1)}d`;
  return (
    <span className="tabular whitespace-nowrap" title={new Date(ms).toISOString()}>
      {d >= 0 ? `in ${txt}` : `${txt} ago`}
    </span>
  );
}
