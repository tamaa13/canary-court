import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** agents/ package root (works from src/ and test/). */
export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env loader (no dependency); real env vars win. */
function loadDotEnv(): void {
  const p = resolve(PKG_ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    const [, k, raw] = m;
    const v = raw.replace(/^['"]|['"]$/g, '');
    if (process.env[k] === undefined && v !== '') process.env[k] = v;
  }
}
loadDotEnv();

const env = (k: string, d: string): string => process.env[k] || d;

type Role = 'client' | 'provider' | 'evaluator';

/** Logical agent names used throughout the runtime. */
export type AgentName = 'client' | 'lead' | 'sub1' | 'sub2' | 'mallory' | 'copycat';

const ROOT = env('ROOT_ACCOUNT', 'arifnovrian.testnet');

export const config = {
  network: env('NEAR_NETWORK', 'testnet'),
  /** Comma-separated; first is primary, the rest are failovers. rpc.testnet.near.org is deprecated/rate-limited. */
  rpcUrls: env('NEAR_RPC_URL', 'https://test.rpc.fastnear.com,https://archival-rpc.testnet.fastnear.com,https://rpc.testnet.near.org').split(',').map((s) => s.trim()).filter(Boolean),
  explorer: env('NEAR_EXPLORER', 'https://testnet.nearblocks.io'),
  rootAccount: ROOT,
  redteamContract: env('REDTEAM_CONTRACT', `redteam.${ROOT}`),
  tusdcContract: env('TUSDC_CONTRACT', `tusdc.${ROOT}`),
  keysDir: resolve(PKG_ROOT, env('AGENT_KEYS_DIR', '.keys')),
  legacyKeychain: resolve(process.env.HOME ?? '~', '.near-credentials', env('NEAR_NETWORK', 'testnet')),
  fixturesDir: resolve(PKG_ROOT, 'fixtures'),
  outlayerFeeYocto: 20_000_000_000_000_000_000_000n, // 0.02 NEAR (spec §4)
  llm: {
    apiKey: process.env.NEARAI_API_KEY ?? '',
    baseUrl: env('NEARAI_BASE_URL', 'https://cloud-api.near.ai/v1'),
    model: env('NEARAI_MODEL', 'Qwen/Qwen3.6-35B-A3B-FP8'),
  },
  /** Category allow-list (spec v0.3, contracts policy). */
  categories: ['prompt_injection', 'tool_misuse', 'data_exfiltration', 'jailbreak'] as const,
  accounts: {
    client: `client.${ROOT}`,
    lead: `provider.${ROOT}`,
    sub1: `sub1.${ROOT}`,
    sub2: `sub2.${ROOT}`,
    mallory: `mallory.${ROOT}`,
    /** client-role attacker for the replay scenario (S5): copies other clients' sealed targets */
    copycat: `copycat.${ROOT}`,
  } satisfies Record<AgentName, string>,
  roles: {
    client: 'client',
    lead: 'provider',
    sub1: 'provider',
    sub2: 'provider',
    mallory: 'provider',
    copycat: 'client',
  } satisfies Record<AgentName, Role>,
};

export type Category = (typeof config.categories)[number];

/** Methods on the agents' function-call key (contracts/DEPLOYMENTS.md). All 0-deposit. */
export const FC_METHODS = [
  'register_agent', 'register_target', 'create_job', 'place_bid', 'counter_bid', 'accept_bid',
  'create_subjob', 'submit_finding', 'expire_job', 'withdraw', 'withdraw_compute',
];


export function txUrl(hash: string): string {
  return `${config.explorer}/txns/${hash}`;
}
