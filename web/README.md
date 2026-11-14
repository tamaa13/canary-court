# web: e2e harness + shared protocol libs

The dashboard moved to `site/` (`cd site && pnpm install && pnpm dev` → http://localhost:3100 for the landing page and `/app` for the dashboard). `web/` now holds only the end-to-end harness and the libraries it shares with the rest of the repo.

```bash
pnpm install
pnpm typecheck
pnpm test            # harness self-test (fault injection) + ECIES / binding-evidence vectors
pnpm e2e:mock        # 54 steps against the in-process spec model, no network, under 1 s
pnpm e2e:testnet     # live testnet; prints the cost estimate and exits; add --yes to run (see e2e/README.md)
pnpm e2e:probe       # read-only dump of the live contract
```

Read-only verification tools (they sign nothing):

| Command | What it does |
|---|---|
| `pnpm verify:demo <demo-receipts.json> [out.md]` | Checks an agents demo fixture against chain: receipts, findings, money invariants, infra timeouts, attestation. |
| `pnpm verify:incidents <out.json> <runId…>` | Lists every OutLayer infra timeout and NEAR AI error of e2e runs, from the policy log. |
| `pnpm verify:attestation <run.json> <out.json>` | Re-runs step 05.8 (attestation chain) read-only against a finished run's own txs. |
| `pnpm report:merge <full.json> <rerun.json[,…]> <out.md> …` | Lays a full run and its re-runs side by side in one report. |

Layout:

```
lib/types.ts       spec §4 + contracts/VIEWS.md shapes, ERR codes
lib/rpc.ts         NEAR JSON-RPC client (views, tx status, limiter with shared cooldown)
lib/ecies.ts       spec §5 ECIES (x25519 + HKDF-SHA256 + ChaCha20-Poly1305), plus vector tests
lib/amount.ts      tUSDC / NEAR unit helpers
lib/mock-net.ts    in-process model of the contract + enclave (the e2e mock backend)
lib/ledger.ts      job-tree money accounting: paid, refunded, in escrow (used by verify-demo)
e2e/               harness, steps, reports. See e2e/README.md and e2e/PLAN.md
```

Final release evidence: `e2e/reports/release-final.md` (enclave v0.1.3 on testnet: 54 steps, 53 pass, 1 not exercised: 07.5, the timeout path, had no natural timeout to check).
