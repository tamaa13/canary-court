/** tUSDC has 6 decimals; amounts travel as U128 strings. */
export const USDC = (whole: number | string): bigint => {
  const [i, f = ''] = String(whole).split('.');
  return BigInt(i) * 1_000_000n + BigInt((f + '000000').slice(0, 6));
};

export function fmtUsdc(v: bigint | string): string {
  const n = BigInt(v);
  const neg = n < 0n;
  const a = neg ? -n : n;
  const i = a / 1_000_000n;
  const f = (a % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${i}${f ? '.' + f : ''} tUSDC`;
}

export const NEAR = (whole: number | string): bigint => {
  const [i, f = ''] = String(whole).split('.');
  return BigInt(i) * 10n ** 24n + BigInt((f + '0'.repeat(24)).slice(0, 24));
};

export function fmtNear(v: bigint | string): string {
  const n = BigInt(v);
  const i = n / 10n ** 24n;
  const f = (n % 10n ** 24n).toString().padStart(24, '0').slice(0, 4).replace(/0+$/, '');
  return `${i}${f ? '.' + f : ''} NEAR`;
}
