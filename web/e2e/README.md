# e2e tests: how to run them

Everything runs from `web/`. Do `pnpm install` once first. The full test plan and coverage matrix is in [PLAN.md](PLAN.md).

| Do | See |
|---|---|
| `pnpm e2e:mock` | 54 steps against an in-process model of the spec, with no network and no keys. They finish in under a second with `✓ 52/54 steps passed, 2 n/a (not exercised)`: 05.7 and 05.8 check OutLayer receipts and TEE attestation, which only exist on testnet. The report is at `e2e/reports/latest-mock.md`. |
| `pnpm test` | The harness self-test (the suite fails the right step for each of 12 injected spec violations) and the ECIES and binding-evidence checks against the team's test vectors. |
| `pnpm e2e:probe` | A read-only dump of the live contract: config, counts, jobs, agents, policy log. Signs nothing. |
| `pnpm e2e:testnet` | A cost estimate, then exit code 2. Nothing is sent. |
| `pnpm e2e:testnet --yes --only=01,99` | A live smoke run: 7 fresh accounts `e<run>-*.arifnovrian.testnet` are created, funded and registered, then deleted. Takes ~1 min. |
| `pnpm e2e:testnet --yes` | The full live run, ~30 min. It waits out real job deadlines so it can test expiry and refunds. The target uses the enclave's free deterministic `mock` model. The report is at `e2e/reports/latest-testnet.md`, with a nearblocks link for every tx. |
| `E2E_TARGET_MODEL=Qwen/Qwen3.6-35B-A3B-FP8 pnpm e2e:testnet --yes` | The same run on live TEE inference on NEAR AI Cloud: about 8 model calls, under $0.02. Step 05.8 then also verifies the model signatures and a fresh-nonce attestation. |
| `… --keep` | Same as above, but the run accounts are kept so you can inspect them in the dashboard (`cd site && pnpm dev`, then `/app?mode=live&e2e=1`) or on nearblocks. |
| `… --only=05,08` | Runs only those areas (or step ids such as `05.3`). Each step's dependencies are pulled in automatically. |
| `… --receipts=<path>` | Verifies an attack-receipts file other than `../agents/fixtures/attack-receipts.json`. |

Exit code is 0 only when no step failed or was skipped. Steps whose dependency failed are listed as skipped. A step that finished but ran 0 checks is listed as n/a (not exercised), never as a pass; it doesn't fail the run.

## Reading a report

- The **Summary** table has one row per step: ✅ pass, ❌ FAIL, ⏭ skip, ➖ n/a (0 checks: not exercised), and ⚠ for a pass that has soft warnings (expectations beyond the spec text).
- **Failures** gives the first failing check of each failed step and the last tx it sent.
- **Details** lists every check (✓/✗/⚠) and every tx: signer → receiver.method, then `ok` or the panic code. On testnet each tx links to `https://testnet.nearblocks.io/txns/<hash>`. A rejection with hash `—` never made it on chain, for example an FC key calling `tusdc.ft_transfer`.

## Live-run requirements

- `~/.near-credentials/testnet/arifnovrian.testnet.json` (the funder's full-access key). Each run moves ~2.75 NEAR out and returns it at teardown, except gas and the OutLayer fees (0.02 NEAR per finding).
- `redteam` has `set_enclave` done, meaning `get_config().enclave_pubkey` is non-empty. Until then, steps 01.6 and later fail; `--only=01,99` still works.
- To re-verify attack receipts on chain, run `pnpm attacks` in `agents/` first.
- Live runs spend from a shared funder account; avoid running two at once.
- Env overrides: `ROOT_ACCOUNT`, `REDTEAM_CONTRACT`, `TUSDC_CONTRACT`, `NEAR_RPC_URL`, `E2E_TARGET_MODEL`, and the timing knobs in PLAN.md.

## Layout

```
e2e/run.ts              CLI: picks the backend, runs the steps, writes the report
e2e/tests/steps.ts      the suite: all steps, in execution order
e2e/harness/chain.ts    Chain interface; MockChain (lib/mock-net.ts) and TestnetChain (near-api-js + JSON-RPC)
e2e/harness/suite.ts    runner, assertions (ok / eq / reject-with-ERR_ / soft / waitFor), dependency skipping
e2e/harness/ctx.ts      per-run actors, amounts, timings, x25519 keys, the e2e target secret
e2e/harness/report.ts   markdown report
e2e/selftest.test.ts    fault-injection self-test
e2e/.keys/              throwaway testnet keys of run accounts (gitignored, deleted after teardown)
```
