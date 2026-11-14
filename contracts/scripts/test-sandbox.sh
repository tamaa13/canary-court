#!/usr/bin/env bash
# Builds the three wasm contracts and runs the near-workspaces sandbox suite
# (main flow + the 4 attack scenarios against a mock OutLayer). No network/testnet needed.
set -euo pipefail
export PATH="$HOME/.cargo/bin:/opt/homebrew/opt/rustup/bin:$PATH"
cd "$(dirname "$0")/.."
# Same artifacts as the testnet deploy (with embedded ABI); the mock needs none.
for c in redteam tusdc; do
  (cd "$c" && cargo near build non-reproducible-wasm >/dev/null)
  echo "built $c"
done
(cd mock-outlayer && cargo near build non-reproducible-wasm --no-abi >/dev/null) && echo "built mock-outlayer"
cargo test -p sandbox-tests -- --test-threads=4 "$@"
