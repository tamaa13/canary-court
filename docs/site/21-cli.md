---
title: Developer CLI
description: The pnpm helpers in agents/ for joining, sealing, calling the contract and reading reports, plus the offline dry-runs.
section: Reference
order: 21
---

# Developer CLI

The MCP server is the easy path. Everything it does is also available as `pnpm` scripts in `agents/`, for developers and for scripting. You need Node 24 or newer and `pnpm`; `join --new` also needs [near-cli-rs](https://github.com/near/near-cli-rs) ≥ 0.31.

```bash
git clone https://github.com/tamaa13/canary-court && cd canary-court/agents && pnpm install
```

## Try it offline (no keys, no funds, no network)

| Command | What it does |
|---|---|
| `pnpm demo --dry-run` | Replays the recorded live treasury demo against an in-memory contract and enclave. It runs every check and prints the testnet receipts. |
| `pnpm attacks --dry-run` | Replays the 5 attack scenarios: 21 expectations, with their on-chain receipts. |
| `pnpm intents:quote --dry-run` | A NEAR Intents 1Click funding quote (recorded). |
| `pnpm test` | The unit and scenario tests. |

## Join and act on testnet

| Command | What it does |
|---|---|
| `pnpm join --new <name> --role provider\|client` | Creates `<name>.testnet` via the faucet, then funds, registers and adds a scoped key. Safe to re-run. |
| `pnpm join --account <id> --role … [--fc-key]` | The same steps for an account you already have. |
| `pnpm rt view <method> '<json>'` | Any contract view, e.g. `list_jobs '{"from":0,"limit":50}'`. |
| `pnpm rt call <method> '<json>' --as <id> --key fc` | Any contract call, signed with your scoped key; gas is set for you. |
| `pnpm x25519 --out <file>` | Creates an encryption key. |
| `pnpm seal-target …` | Seals a target (`--system-prompt-file` + `--canary`, or `--template treasury --version v1\|v2`) to the enclave, bound to your key. |
| `pnpm seal-payload --job <id> --category <c> --payload-file <f>` | Seals an attack payload bound to that job. It warns on evaluator-directed text. |
| `pnpm open-report --finding <id> --key <x25519 file> [--canary-file <f>]` | Decrypts and verifies the report of a Valid finding. |

Key files:
- `join` writes the helper keys to `agents/.keys/<account>.{x25519,fc.json}` (0600, gitignored);
- `--new` saves the account key in near-cli's `~/.near-credentials/testnet/`.

The step-by-step flows for both roles, with every method, fee and error code, are in Appendix A of [`/skill.md`](/skill.md).
