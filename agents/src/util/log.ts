/** Terminal output. With `--json`, human logs go to stderr so stdout stays machine-readable. */
import { txUrl } from '../config.js';

const tty = process.stderr.isTTY && !process.env.NO_COLOR;
const c = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const color = {
  dim: c(2), bold: c(1), red: c(31), green: c(32), yellow: c(33), blue: c(34), magenta: c(35), cyan: c(36), gray: c(90),
};

let toStderr = false;
export function logToStderr(on: boolean): void {
  toStderr = on;
}
function out(s: string): void {
  (toStderr ? process.stderr : process.stdout).write(s + '\n');
}

const AGENT_COLORS: Record<string, (s: string) => string> = {
  client: color.cyan, lead: color.magenta, sub1: color.blue, sub2: color.blue, mallory: color.red, copycat: color.red,
  contract: color.yellow, enclave: color.green, system: color.gray,
};

/** Secrets registered here are masked in every log line (e.g. the client's canary). */
const redactions = new Set<string>();
export function redact(secret: string): void {
  if (secret) redactions.add(secret);
}
function mask(s: string): string {
  let r = s;
  for (const x of redactions) r = r.split(x).join('«redacted»');
  return r;
}

export const log = {
  section(title: string): void {
    out('');
    out(color.bold(`━━ ${title} ${'━'.repeat(Math.max(0, 70 - title.length))}`));
  },
  agent(name: string, msg: string): void {
    const tag = (AGENT_COLORS[name] ?? color.gray)(`[${name}]`.padEnd(10));
    out(`${tag} ${mask(msg)}`);
  },
  think(source: string, rationale: string): void {
    out(`${' '.repeat(11)}${color.dim(`↳ ${source}: ${mask(rationale).slice(0, 240)}`)}`);
  },
  tx(method: string, hash: string | null, mock: boolean): void {
    const link = hash ? color.gray(txUrl(hash)) : color.gray(mock ? '(in-memory)' : '(no tx)');
    out(`${' '.repeat(11)}${color.green('✓')} ${method} ${link}`);
  },
  rejected(method: string, msg: string, hash: string | null, stage: 'rpc' | 'execution' = 'rpc', mock = false): void {
    const where = hash ? color.gray(txUrl(hash)) : color.gray(stage === 'rpc' ? '(rejected before inclusion)' : mock ? '(in-memory panic)' : '(panic)');
    out(`${' '.repeat(11)}${color.red('✗')} ${method}: ${color.red(mask(msg).slice(0, 200))} ${where}`);
  },
  info(msg: string): void {
    out(`${' '.repeat(11)}${mask(msg)}`);
  },
  ok(msg: string): void {
    out(`${color.green('PASS')} ${mask(msg)}`);
  },
  fail(msg: string): void {
    out(`${color.red('FAIL')} ${mask(msg)}`);
  },
  warn(msg: string): void {
    out(`${color.yellow('WARN')} ${mask(msg)}`);
  },
};
