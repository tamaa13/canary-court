// Whole numbers, grouped the way the page writes them (amounts in tUSDC/NEAR are lib/market/amount.ts).

const group = new Intl.NumberFormat("en-US");

/** 277555673 → "277,555,673" */
export const int = (n: number | bigint) => group.format(n);
