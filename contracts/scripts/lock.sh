#!/usr/bin/env bash
# Canary Court: lock the escrow contract by deleting every full-access key on its account.
#
# After this, nobody can redeploy redteam's code. That closes the vector where the key holder
# deploys code that re-asks the enclave to re-evaluate public ciphertexts with a report key of
# their choosing. Owner methods (set_policy / set_enclave / resync_compute_liabilities) keep
# working, because they are authorized by the OWNER account (arifnovrian.testnet), not by a key
# on redteam.
#
# Usage:
#   contracts/scripts/lock.sh <expected_code_sha256_hex>              # dry run: checks only
#   CONFIRM=LOCK-redteam contracts/scripts/lock.sh <sha> --execute    # deletes the FA key(s)
#
# Dry run and execute both:
#   1. check the deployed code sha256 == <expected_code_sha256_hex> (the final audited build)
#   2. check get_config.owner is a DIFFERENT account that we hold a key for (else owner ops would brick)
#   3. check there are no in-flight evaluations (pending == 0 on every job)
#   4. list the account's access keys
# Execute only:
#   5. delete all full-access keys on the account
#   6. post-lock: 0 full-access keys, views work, the owner can still call set_policy (a no-op re-set
#      of the current policy), and the code hash is unchanged
# Testnet only.
set -euo pipefail
export PATH="$HOME/.cargo/bin:/opt/homebrew/opt/rustup/bin:$PATH"

ACCOUNT=${ACCOUNT:-redteam.arifnovrian.testnet}
NET=${NET:-testnet}
EXPECTED_SHA=${1:?usage: lock.sh <expected_code_sha256_hex> [--execute]}
MODE=${2:-dry-run}
CREDS="$HOME/.near-credentials/testnet"

say()  { printf '\n== %s\n' "$*"; }
die()  { printf '\nFAIL: %s\n' "$*" >&2; exit 1; }
view() { near contract call-function as-read-only "$ACCOUNT" "$1" json-args "$2" network-config "$NET" now 2>&1 |
           sed -n '/return value/,$p' | grep -vE "return value|console command|near contract|^\s*$"; }
full_access_keys() { near account list-keys "$ACCOUNT" network-config "$NET" now 2>&1 |
           grep "full access" | grep -oE "ed25519:[1-9A-HJ-NP-Za-km-z]+" || true; }
code_sha() { near contract inspect "$ACCOUNT" network-config "$NET" now 2>&1 |
           grep "SHA-256 checksum \[hex\]" | grep -oE "[0-9a-f]{64}" | head -1; }

say "1. deployed code hash"
SHA=$(code_sha)
echo "deployed: $SHA"
echo "expected: $EXPECTED_SHA"
[ "$SHA" = "$EXPECTED_SHA" ] || die "deployed code is not the expected final build"

say "2. owner is a separate account we control"
OWNER=$(view get_config '{}' | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["owner"])')
echo "owner: $OWNER"
[ "$OWNER" != "$ACCOUNT" ] || die "owner == contract account; deleting its key would brick owner methods"
ls "$CREDS/$OWNER.json" >/dev/null 2>&1 || die "no local key for owner $OWNER in $CREDS"

say "3. no in-flight evaluations"
PENDING=$(view list_jobs '{"from":0,"limit":200}' | python3 -I -c 'import json,sys; print(sum(j["pending"] for j in json.load(sys.stdin)))')
echo "pending evaluations: $PENDING"
[ "$PENDING" = "0" ] || die "evaluations in flight; retry when pending == 0"
COUNTS=$(view get_counts '{}' | tr -d '\n ')
echo "counts: $COUNTS"
[ "$(view get_counts '{}' | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["jobs"])')" -le 200 ] ||
  echo "note: >200 jobs, pending check only covered the first 200"

say "4. access keys on $ACCOUNT"
near account list-keys "$ACCOUNT" network-config "$NET" now 2>&1 | grep -E "^\|" || true
KEYS=$(full_access_keys)
[ -n "$KEYS" ] || { echo "no full-access keys: already locked"; exit 0; }
echo "full-access keys to delete:"; echo "$KEYS"

if [ "$MODE" != "--execute" ]; then
  say "DRY RUN OK. To lock for real:"
  echo "  CONFIRM=LOCK-redteam $0 $EXPECTED_SHA --execute"
  exit 0
fi
[ "${CONFIRM:-}" = "LOCK-redteam" ] || die "set CONFIRM=LOCK-redteam to execute"

say "5. deleting full-access keys (irreversible)"
PKS=$(echo "$KEYS" | paste -sd, -)
near account delete-keys "$ACCOUNT" public-keys "$PKS" network-config "$NET" \
  sign-with-legacy-keychain send 2>&1 | grep -E "Transaction ID|deleted|Error|error" || true

say "6. post-lock verification"
LEFT=$(full_access_keys)
[ -z "$LEFT" ] || die "full-access keys still present: $LEFT"
echo "full-access keys: none"
[ "$(code_sha)" = "$EXPECTED_SHA" ] || die "code hash changed"
echo "code hash unchanged: $EXPECTED_SHA"
view get_solvency '{}' | tr -d '\n '; echo
POLICY=$(view get_config '{}' | python3 -I -c 'import json,sys; print(json.dumps({"policy": json.load(sys.stdin)["policy"]}))')
OUT=$(near contract call-function as-transaction "$ACCOUNT" set_policy json-args "$POLICY" \
  prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as "$OWNER" \
  network-config "$NET" sign-with-legacy-keychain send 2>&1)
echo "$OUT" | grep -E "Transaction ID" | head -1
echo "$OUT" | grep -q "policy_updated" || die "owner set_policy failed after lock"
echo "owner method set_policy still works (no-op re-set of the current policy)"
say "LOCKED. Record the delete-keys tx above in contracts/README.md (Locked contract)."
