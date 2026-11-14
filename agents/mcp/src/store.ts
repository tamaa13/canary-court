/**
 * Local key store: ~/.canary-court/<account>/ (dir 0700, files 0600), override with CANARY_COURT_HOME.
 * Keys never leave this machine: they are only used to sign transactions locally.
 *   full_access.json  the account's own key (created with the account; deposits + adding the FC key)
 *   fc.json           function-call key scoped to the escrow (all 0-deposit calls)
 *   x25519.key        hex secret for ECIES (sealed targets/reports)
 *   targets/<id>.json canaries of targets you created (to verify reports)
 *   state.json        role, notification cursor, your bids
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { emptyNotifState, type NotifState } from './pure.js';

export const HOME = process.env.CANARY_COURT_HOME || join(homedir(), '.canary-court');

export interface KeyFile { account_id: string; public_key: string; private_key: string }
export interface AgentState { role?: 'client' | 'provider'; notif: NotifState; my_bids: number[] }

export const paths = (account: string) => {
  const dir = join(HOME, account);
  return { dir, fa: join(dir, 'full_access.json'), fc: join(dir, 'fc.json'), x25519: join(dir, 'x25519.key'), state: join(dir, 'state.json'), targets: join(dir, 'targets') };
};

export function writeSecret(path: string, body: string): void {
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(path, body, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export const readJson = <T>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null);

export function activeAccount(): string | null {
  return process.env.CANARY_COURT_ACCOUNT || readJson<{ account: string }>(join(HOME, 'active.json'))?.account || null;
}
export function setActive(account: string): void {
  writeSecret(join(HOME, 'active.json'), JSON.stringify({ account }) + '\n');
}

export function loadState(account: string): AgentState {
  const s = readJson<Partial<AgentState>>(paths(account).state) ?? {};
  return { role: s.role, notif: s.notif ?? emptyNotifState(), my_bids: s.my_bids ?? [] };
}
export function saveState(account: string, s: AgentState): void {
  writeSecret(paths(account).state, JSON.stringify(s, null, 2) + '\n');
}

export function saveTargetSecret(account: string, targetId: string, v: { canary: string; model: string; created_ms: number }): string {
  const p = join(paths(account).targets, `${targetId}.json`);
  writeSecret(p, JSON.stringify(v, null, 2) + '\n');
  return p;
}
export const loadTargetSecret = (account: string, targetId: string) => readJson<{ canary: string; model: string }>(join(paths(account).targets, `${targetId}.json`));
