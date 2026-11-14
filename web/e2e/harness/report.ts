import type { StepResult } from './suite';
import type { Chain } from './chain';

const AREAS: Record<number, string> = {
  1: 'Setup & registration',
  2: 'Job → bid → counter → accept',
  3: 'Counterparty Allow / Warn / Block',
  4: 'Subjob carving & caps',
  5: 'Valid finding → atomic payout, privacy',
  6: 'Invalid & manipulation → strikes → blocklist',
  7: 'OutLayer / enclave failure → Failed',
  8: 'Expiry, refund roll-up, conservation',
  9: 'Withdraw → tUSDC',
  10: 'Attack scenarios (receipts)',
  99: 'Teardown',
};

interface RunMeta {
  run: string;
  chain: Chain;
  startedAt: Date;
  finishedAt: Date;
  accounts: Record<string, string>;
  receiptsPath: string;
  infraTimeouts?: { key: string; finding_id: number; actor: string; detail: string }[];
  /** deployed redteam wasm sha256 (hex) and the enclave wasm hash pinned in get_config */
  contractCodeHash?: string | null;
  enclaveHash?: string | null;
  enclavePubkey?: string | null;
  /** from enclave/deployments/<sha>.json; falls back to the static table below */
  enclaveVersion?: string | null;
}

const ENCLAVE_VERSIONS: Record<string, string> = {
  '1ab104255db5223df8352923e02f9cb042e3f546f115ba8d727eab0147c5f28a': 'v0.1.2',
  df9880fc8740ab108123ca7493953dd09a9f84f64efd660443cfb6d78ea12f98: 'v0.1.1',
  '981db5c8485e50f4f08a59db94435b0ad5580f526d52305c5c20cacdfac54d92': 'v0.1.0',
};

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderMarkdown(results: StepResult[], m: RunMeta): string {
  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const skip = results.filter((r) => r.status === 'skip').length;
  const na = results.filter((r) => r.status === 'na').length;
  const warn = results.reduce((x, r) => x + r.warnings, 0);
  const checks = results.reduce((x, r) => x + r.checks.length, 0);
  const txCount = results.reduce((x, r) => x + r.txs.length, 0);
  const verdict = fail === 0 && skip === 0 ? 'PASS' : 'FAIL';
  const link = (hash: string | null) => {
    if (!hash) return '—';
    const url = m.chain.txLink(hash);
    return url ? `[${hash.slice(0, 8)}…](${url})` : `\`${hash.slice(0, 8)}…\` (mock)`;
  };
  const L: string[] = [];
  L.push(`# Canary Court e2e: run \`${m.run}\` on ${m.chain.kind}: **${verdict}**`, '');
  L.push(`- **${pass} passed · ${fail} failed · ${skip} skipped${na ? ` · ${na} n/a (0 checks: not exercised)` : ''}** (${results.length} steps, ${checks} checks, ${txCount} txs${warn ? `, ${warn} warnings` : ''})`);
  L.push(`- Contract \`${m.chain.contractId}\` · token \`${m.chain.tokenId}\` · funder \`${m.chain.root}\``);
  if (m.contractCodeHash || m.enclaveHash)
    L.push(`- Deployed: contract wasm sha256 \`${m.contractCodeHash ?? '?'}\` · enclave ${m.enclaveVersion ?? (m.enclaveHash ? ENCLAVE_VERSIONS[m.enclaveHash] : null) ?? '(version unknown)'} wasm \`${m.enclaveHash ?? '?'}\`${m.enclavePubkey ? ` · enclave pubkey \`${m.enclavePubkey}\`` : ''} (all read from chain: RPC code_hash + get_config)`);
  L.push(`- Started ${m.startedAt.toISOString()} · took ${Math.round((m.finishedAt.getTime() - m.startedAt.getTime()) / 1000)} s`);
  if (m.chain.kind === 'testnet')
    L.push(`- OutLayer infra timeouts: **${m.infraTimeouts?.length ?? 0}**${m.infraTimeouts?.length ? ` (${m.infraTimeouts.map((x) => `${x.key} #${x.finding_id}`).join(', ')}). Refunded by the contract and resubmitted once; infrastructure, not counted as failures` : ''}`);
  L.push(`- Run accounts: ${Object.entries(m.accounts).map(([k, v]) => `${k}=\`${v}\``).join(', ')}`);
  if (m.chain.kind === 'mock') L.push('- Backend: in-process model of the spec (`web/lib/mock-net.ts`). Tx hashes are synthetic, not on chain.');
  L.push('', '## Summary', '', '| Step | Test | Result | Checks | Txs | Time |', '|---|---|---|---|---|---|');
  let area = -1;
  for (const r of results) {
    if (r.area !== area) {
      area = r.area;
      L.push(`| **${String(area).padStart(2, '0')}** | **${AREAS[area] ?? ''}** | | | | |`);
    }
    const icon = r.status === 'pass' ? (r.warnings ? '✅ pass ⚠️' : '✅ pass') : r.status === 'fail' ? (r.blocking ? '❌ **FAIL**' : '❌ **FAIL** (non-blocking)') : r.status === 'na' ? '➖ n/a' : '⏭ skip';
    L.push(`| ${r.id} | ${esc(r.title)} | ${icon} | ${r.checks.filter((k) => k.ok).length}/${r.checks.length} | ${r.txs.length} | ${(r.ms / 1000).toFixed(1)} s |`);
  }
  const failed = results.filter((r) => r.status === 'fail');
  if (failed.length) {
    L.push('', '## Failures', '');
    for (const r of failed) {
      L.push(`- **${r.id} ${esc(r.title)}**: ${esc(r.error ?? '')}`);
      const lastTx = [...r.txs].reverse().find((x) => x.hash);
      if (lastTx) L.push(`  - last tx: ${link(lastTx.hash)} \`${lastTx.method}\` → ${esc(lastTx.error ?? 'ok')}`);
    }
  }
  L.push('', '## Details', '');
  for (const r of results) {
    L.push(`### ${r.id} ${r.title} (${r.status.toUpperCase()})`, '');
    for (const k of r.checks) L.push(`- ${k.ok ? '✓' : k.soft ? '⚠' : '✗'} ${esc(k.label)}${k.detail ? `  \n  <sub>${esc(k.detail).slice(0, 400)}</sub>` : ''}`);
    for (const n of r.notes) L.push(`- _${esc(n)}_`);
    if (r.txs.length) {
      L.push('', '| tx | label | signer → receiver.method | outcome |', '|---|---|---|---|');
      for (const x of r.txs)
        L.push(`| ${link(x.hash)} | ${esc(x.label ?? '')} | \`${x.signer.split('.')[0]}\` → \`${x.receiver.split('.')[0]}.${x.method}\` | ${x.ok ? 'ok' : esc((x.code ?? x.error ?? 'failed').slice(0, 160))} |`);
    }
    L.push('');
  }
  return L.join('\n');
}
