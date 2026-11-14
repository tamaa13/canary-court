const USDC_DECIMALS = 6;
const NEAR_DECIMALS = 24;

function toUnits(whole: number | string, decimals: number): bigint {
  const [i, f = ''] = String(whole).split('.');
  return BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

function fromUnits(v: bigint | string | number | null | undefined, decimals: number, maxFrac = decimals): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = BigInt(v);
  const neg = n < 0n;
  const a = neg ? -n : n;
  const base = 10n ** BigInt(decimals);
  const i = a / base;
  const f = (a % base).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  return `${neg ? '−' : ''}${i.toLocaleString('en-US')}${f ? '.' + f : ''}`;
}

export const usdc = (whole: number | string) => toUnits(whole, USDC_DECIMALS);
export const near = (whole: number | string) => toUnits(whole, NEAR_DECIMALS);
export const fmtNear = (v: bigint | string | null | undefined) => fromUnits(v, NEAR_DECIMALS, 4);

