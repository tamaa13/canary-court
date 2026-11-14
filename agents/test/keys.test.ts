import { describe, expect, it } from 'vitest';
import { assertFunctionCallOnly } from '../src/crypto/keys.js';

const C = 'redteam.arifnovrian.testnet';
describe('runtime fails closed on dangerous keys', () => {
  it('rejects a full-access key (string and object forms)', () => {
    expect(() => assertFunctionCallOnly('a', 'FullAccess', C)).toThrow(/FAIL CLOSED.*FULL-ACCESS/);
    expect(() => assertFunctionCallOnly('a', { FullAccess: {} }, C)).toThrow(/FAIL CLOSED/);
  });
  it('rejects a function-call key scoped to another contract (e.g. the token)', () => {
    expect(() => assertFunctionCallOnly('a', { FunctionCall: { receiver_id: 'tusdc.arifnovrian.testnet', method_names: [] } }, C)).toThrow(/FAIL CLOSED/);
  });
  it('accepts a function-call key scoped to redteam', () => {
    expect(() => assertFunctionCallOnly('a', { FunctionCall: { receiver_id: C, method_names: ['withdraw'], allowance: '1' } }, C)).not.toThrow();
  });
});
