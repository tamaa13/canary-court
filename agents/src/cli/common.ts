import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config, txUrl } from '../config.js';
import type { Receipt } from '../chain/recorder.js';
import { color, log, logToStderr } from '../util/log.js';

export function cliFlags(argv = process.argv.slice(2)) {
  const val = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  return {
    dryRun: argv.includes('--dry-run'),
    json: argv.includes('--json'),
    settle: !argv.includes('--no-settle'),
    record: argv.includes('--record'),
    replay: val('replay'),
    only: val('only'),
    mockLlm: argv.includes('--mock-llm'),
    liveTarget: argv.includes('--live-target'),
  };
}

export function fixture(name: string, dryRun: boolean): string {
  return resolve(config.fixturesDir, dryRun ? 'local' : '.', name);
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n');
}

export function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null;
}

/** In dry-run, point at the txs recorded from the last live testnet run so judges can verify on chain. */
export function showRecordedTestnetRun(file: string, label: string): void {
  const rec = readJson<{ recorded_at?: string; receipts?: Receipt[] } | Receipt[]>(resolve(config.fixturesDir, file));
  const receipts = Array.isArray(rec) ? rec : rec?.receipts ?? [];
  const withHash = receipts.filter((r) => (r as { tx_hash?: string | null }).tx_hash);
  if (!withHash.length) {
    log.info(color.dim(`(no recorded testnet ${label} yet: fixtures/${file})`));
    return;
  }
  log.section(`recorded testnet ${label} (verify on nearblocks)`);
  for (const r of withHash.slice(0, 40)) {
    const x = r as Receipt & { observed_error?: string };
    log.info(`${(x.ok === false || x.observed_error ? color.red('✗') : color.green('✓'))} ${String(x.method).padEnd(16)} ${color.gray(txUrl(x.tx_hash!))}`);
  }
  if (withHash.length > 40) log.info(color.dim(`… ${withHash.length - 40} more in fixtures/${file}`));
}

export function setJsonMode(on: boolean): void {
  logToStderr(on);
}
