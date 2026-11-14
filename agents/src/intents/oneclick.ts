/**
 * NEAR Intents 1Click Swap API — quote only (`dry: true`): no deposit address is generated and no funds
 * move. Used to show how a client agent would top up its USDC budget from another chain.
 * Docs: https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote
 * 1Click is mainnet-only; our escrow runs on testnet with tUSDC, so this is a preview of the funding leg.
 */
const ONECLICK_URL = process.env.ONECLICK_URL || 'https://1click.chaindefuser.com/v0';

export const ASSETS = {
  NEAR_USDC: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
  ARB_USDC: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
  BASE_USDC: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
  WNEAR: 'nep141:wrap.near',
} as const;

type Rail = 'ORIGIN_CHAIN' | 'INTENTS';

export interface QuoteRequest {
  dry: true;
  swapType: 'EXACT_INPUT' | 'EXACT_OUTPUT';
  slippageTolerance: number;
  originAsset: string;
  depositType: Rail;
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: Rail;
  recipient: string;
  recipientType: 'DESTINATION_CHAIN' | 'INTENTS';
  deadline: string;
  quoteWaitingTimeMs?: number;
}

export interface Quote {
  amountIn: string;
  amountInFormatted: string;
  amountInUsd?: string;
  minAmountIn?: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd?: string;
  minAmountOut: string;
  timeEstimate: number;
  depositAddress?: string;
}

export interface QuoteResponse {
  quote: Quote;
  quoteRequest: QuoteRequest;
  timestamp?: string;
  signature?: string;
  correlationId?: string;
}

async function requestQuote(req: QuoteRequest, jwt = process.env.ONECLICK_JWT): Promise<QuoteResponse> {
  const res = await fetch(`${ONECLICK_URL}/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as QuoteResponse & { message?: string; correlationId?: string };
  if (!res.ok || !body.quote) throw new Error(`1Click ${res.status}: ${body.message ?? 'no quote'} (correlationId ${body.correlationId ?? '-'})`);
  return body;
}

/**
 * Quote `amountUsdc` of USDC on another chain → USDC on NEAR. Tries the direct origin-chain route first and
 * falls back to the Intents-account route (both are dry quotes; the second needs no chain addresses).
 */
export async function fundingQuote(opts: { amountUsdc: number; origin?: string; recipient: string; refundEvm: string }): Promise<{ route: string; res: QuoteResponse; attempts: string[] }> {
  const deadline = new Date(Date.now() + 60 * 60_000).toISOString();
  const base = {
    dry: true as const, swapType: 'EXACT_INPUT' as const, slippageTolerance: 100,
    originAsset: opts.origin ?? ASSETS.ARB_USDC, destinationAsset: ASSETS.NEAR_USDC,
    amount: BigInt(Math.round(opts.amountUsdc * 1e6)).toString(), deadline, quoteWaitingTimeMs: 3000,
  };
  const routes: { route: string; req: QuoteRequest }[] = [
    { route: 'origin chain → NEAR (deposit on Arbitrum, payout to a NEAR account)', req: { ...base, depositType: 'ORIGIN_CHAIN', refundTo: opts.refundEvm, refundType: 'ORIGIN_CHAIN', recipient: opts.recipient, recipientType: 'DESTINATION_CHAIN' } },
    { route: 'Intents account → Intents account (bridged Arbitrum USDC → NEAR USDC)', req: { ...base, depositType: 'INTENTS', refundTo: opts.recipient, refundType: 'INTENTS', recipient: opts.recipient, recipientType: 'INTENTS' } },
  ];
  const attempts: string[] = [];
  for (const r of routes) {
    try {
      return { route: r.route, res: await requestQuote(r.req), attempts };
    } catch (e) {
      attempts.push(`${r.route}: ${(e as Error).message}`);
    }
  }
  throw new Error(`no 1Click route returned a quote:\n  ${attempts.join('\n  ')}`);
}
