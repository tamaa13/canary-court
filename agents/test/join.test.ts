import { describe, expect, it } from 'vitest';
import { faucetCreateArgs, newTestnetAccountId, redactSecrets } from '../src/cli/ext-common.js';

describe('join --new helpers', () => {
  it('maps a name to a top-level .testnet account (with or without the suffix)', () => {
    expect(newTestnetAccountId('my-agent-01')).toBe('my-agent-01.testnet');
    expect(newTestnetAccountId('my_agent.testnet')).toBe('my_agent.testnet');
  });

  it('rejects names the faucet cannot create', () => {
    for (const bad of ['a', 'My-Agent', 'sub.name', 'x.near', '-lead', 'trail-', 'a--b', 'a'.repeat(57), '']) {
      expect(() => newTestnetAccountId(bad), bad).toThrow(/invalid --new name/);
    }
  });

  it('asks near-cli for a faucet-sponsored account saved to the legacy keychain on testnet', () => {
    const a = faucetCreateArgs('cc-x.testnet');
    expect(a.slice(0, 4)).toEqual(['account', 'create-account', 'sponsor-by-faucet-service', 'cc-x.testnet']);
    expect(a).toEqual(expect.arrayContaining(['autogenerate-new-keypair', 'save-to-legacy-keychain', 'testnet']));
    expect(a).not.toContain('mainnet');
  });

  it('redacts secret keys and seed phrases from echoed tool output, keeps public keys', () => {
    const sk = `ed25519:${'3'.repeat(88)}`;
    const pk = `ed25519:${'4'.repeat(44)}`;
    const out = redactSecrets(`private ${sk}\npublic ${pk}\nYour seed phrase: alpha beta gamma\nok`);
    expect(out).not.toContain(sk);
    expect(out).toContain(pk);
    expect(out).not.toMatch(/alpha beta/);
    expect(out).toContain('ok');
  });
});
