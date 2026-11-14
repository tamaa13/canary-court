// Cross-check of enclave v0.1.2 binding evidence (enclave/test-vectors/binding.json): result_hash = sha256(error_record),
// and the e2e/mock error_record field order matches the enclave's.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { sha256Hex } from './ecies';

const file = [resolve(__dirname, '../../enclave/test-vectors/binding.json'), join(homedir(), 'projects/near-redteam-enclave/enclave/test-vectors/binding.json')].find(existsSync);

describe.skipIf(!file)('enclave binding evidence vectors', () => {
  const doc = file ? (JSON.parse(readFileSync(file, 'utf8')) as { payload_binding_evidence?: { examples?: { error_record: string; result_hash: string }[] } }) : {};
  const examples = doc.payload_binding_evidence?.examples ?? [];
  it('has examples', () => expect(examples.length).toBeGreaterThan(0));
  for (const [i, ex] of examples.entries()) {
    it(`example ${i}: sha256(error_record) = result_hash, field order matches the mock`, () => {
      expect(sha256Hex(ex.error_record)).toBe(ex.result_hash);
      const r = JSON.parse(ex.error_record);
      const mine = JSON.stringify({ v: 1, job_id: r.job_id, root_job_id: r.root_job_id, finding_id: r.finding_id, code: 'PAYLOAD_BINDING_MISMATCH', claimed_job_id: r.claimed_job_id });
      expect(mine).toBe(ex.error_record);
    });
  }
});
