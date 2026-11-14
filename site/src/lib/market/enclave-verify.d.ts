declare module '@enclave/verify' {
  export interface Check {
    id: string;
    label: string;
    ok: boolean | null;
    detail: string;
  }
  export interface Result {
    ok: boolean | null;
    checks: Check[];
  }
  export const TESTNET: Record<string, unknown>;
  export function verifyEnclave(cfg?: unknown, opts?: { fetchWasm?: boolean }): Promise<Result & { enclave?: { wasm_sha256: string; url: string; enclave_pubkey: string } }>;
  export function verifyFinding(
    cfg: unknown,
    txHash: string,
    signerId: string,
    opts?: { expectHash?: string; expectPredecessor?: string; resolveWorker?: boolean },
  ): Promise<
    Result & {
      output?: { llm?: string; model?: string | null; valid?: boolean; severity?: string; dedup_key?: string | null; warnings?: string[]; model_signatures?: { signing_address: string }[] } | null;
    }
  >;
  export function verifyModelAttestation(cfg: unknown, model: string, expectAddress?: string, nonceHex?: string): Promise<Result & { nonce?: string; report?: Record<string, unknown> }>;
}
