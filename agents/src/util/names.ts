/** Pure helpers for onboarding (shared by `pnpm join` and the MCP server). */

/** `--new <name>` → `<name>.testnet`: a top-level testnet account, which is what the faucet can create. */
export function newTestnetAccountId(name: string): string {
  const base = name.endsWith('.testnet') ? name.slice(0, -'.testnet'.length) : name;
  if (base.length < 2 || base.length > 56 || !/^[a-z0-9]+([-_][a-z0-9]+)*$/.test(base)) {
    throw new Error(`invalid --new name "${name}": use 2–56 chars of a-z, 0-9, "-" or "_" (no dots), e.g. my-agent-01`);
  }
  return `${base}.testnet`;
}

/** near-cli-rs: create `accountId` sponsored by the testnet faucet; the new key goes to the legacy keychain. */
export const faucetCreateArgs = (accountId: string): string[] => [
  'account', 'create-account', 'sponsor-by-faucet-service', accountId,
  'autogenerate-new-keypair', 'save-to-legacy-keychain', 'network-config', 'testnet', 'create',
];

/** Strip anything that looks like a secret key or seed phrase before echoing tool output. */
export const redactSecrets = (s: string): string =>
  s.replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{60,}/g, 'ed25519:<redacted>').replace(/^.*seed phrase.*$/gim, '<seed phrase line redacted>');
