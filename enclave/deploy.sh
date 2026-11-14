#!/usr/bin/env bash
# One-command (re)deploy of the enclave module to OutLayer TESTNET.
#
#   ./deploy.sh --dry-run     build + print the plan, touch nothing on chain
#   ./deploy.sh               build → FastFS upload (inclusion + sha checked) → TEE-generated
#                             PROTECTED_ENCLAVE_KEY + NEARAI_API_KEY (piped from macOS Keychain,
#                             never printed) bound to the new wasm hash, owner-only →
#                             op:pubkey via OutLayer → lock to Predecessor{CALLER} → verify →
#                             deployments/<sha>.json + verify.mjs pins updated.
#
# Needs: outlayer CLI logged in as $OWNER (testnet), near CLI with $OWNER in the legacy keychain,
# Keychain item `near-redteam-nearai` / account `nearai`. Costs ≈ 0.03 NEAR (+0.1 NEAR secrets
# deposit, mostly refunded). Does NOT call set_enclave (that's the contract owner's step) and does
# NOT delete the previous build's secret row (do that after the contract switched over).
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:/opt/homebrew/opt/rustup/bin:$PATH"

OWNER=${OWNER:-arifnovrian.testnet}
CALLER=${CALLER:-redteam.arifnovrian.testnet}
PROFILE=${PROFILE:-enclave}
OUTLAYER=outlayer.testnet
RPC=https://rpc.testnet.fastnear.com
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

say() { printf '\033[1m==> %s\033[0m\n' "$*" >&2; }
die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# tx status via RPC: prints final SuccessValue (decoded) or the failure, "" if unknown
tx_result() { python3 -I - "$1" "$2" "$RPC" <<'EOF'
import json,sys,base64,urllib.request
tx,sender,rpc=sys.argv[1:4]
req={"jsonrpc":"2.0","id":1,"method":"tx","params":{"tx_hash":tx,"sender_account_id":sender,"wait_until":"FINAL"}}
try:
    r=json.load(urllib.request.urlopen(urllib.request.Request(rpc,json.dumps(req).encode(),{"Content-Type":"application/json"}),timeout=60))
except Exception: print(""); sys.exit(0)
st=(r.get("result") or {}).get("status") or {}
print(base64.b64decode(st["SuccessValue"]).decode() if "SuccessValue" in st else json.dumps(st))
EOF
}
tx_known() { python3 -I - "$1" "$2" "$RPC" <<'EOF'
import json,sys,urllib.request
tx,sender,rpc=sys.argv[1:4]
req={"jsonrpc":"2.0","id":1,"method":"tx","params":{"tx_hash":tx,"sender_account_id":sender,"wait_until":"NONE"}}
try:
    r=json.load(urllib.request.urlopen(urllib.request.Request(rpc,json.dumps(req).encode(),{"Content-Type":"application/json"}),timeout=20))
    print("yes" if "result" in r else "no")
except Exception: print("no")
EOF
}
get_secret_row() { python3 -I - "$1" "$PROFILE" "$OWNER" "$RPC" "$OUTLAYER" <<'EOF'
import json,sys,base64,urllib.request
h,prof,owner,rpc,ol=sys.argv[1:6]
args=base64.b64encode(json.dumps({"accessor":{"WasmHash":{"hash":h}},"profile":prof,"owner":owner}).encode()).decode()
req={"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":ol,"method_name":"get_secrets","args_base64":args}}
r=json.load(urllib.request.urlopen(urllib.request.Request(rpc,json.dumps(req).encode(),{"Content-Type":"application/json"}),timeout=30))
v=json.loads(bytes(r["result"]["result"])) if "result" in r else None
if v: v.pop("encrypted_secrets",None)
print(json.dumps(v))
EOF
}
near_tx() { # near_tx <receiver> <method> <json> <deposit> → prints tx id
  local out; out=$(near contract call-function as-transaction "$1" "$2" json-args "$3" prepaid-gas '300.0 Tgas' \
    attached-deposit "$4" sign-as "$OWNER" network-config testnet sign-with-legacy-keychain send 2>&1) || true
  echo "$out" | grep -E "panicked|Error" | head -3 >&2 || true
  echo "$out" | grep -oE "Transaction ID: [1-9A-HJ-NP-Za-km-z]+" | head -1 | awk '{print $3}'
}

# ---------------------------------------------------------------- 1. build
say "1/6 build (rustc 1.88, reproducible)"
./build.sh >/dev/null
W=target/wasm32-wasip2/release/redteam-enclave.wasm
H=$(shasum -a 256 "$W" | cut -c1-64)
URL="https://test.fastfs.io/$OWNER/$OUTLAYER/$H.wasm"
VERSION=$(grep -m1 '^version' Cargo.toml | cut -d'"' -f2)
say "   v$VERSION  sha256=$H"
if wasm-tools component wit "$W" 2>/dev/null | grep -E "^\s*import" | grep -qv "@0\.2\.[0-6];"; then
  die "wasm imports WASI > 0.2.6, the OutLayer worker (wasmtime 36) cannot instantiate it"
fi
if [ $DRY = 1 ]; then
  say "dry run: would upload $URL, bind PROTECTED_ENCLAVE_KEY + NEARAI_API_KEY to $H (profile $PROFILE, owner $OWNER), run op:pubkey, lock to Predecessor{$CALLER}"
  security find-generic-password -s near-redteam-nearai -a nearai >/dev/null 2>&1 && say "   keychain item present" || die "keychain item near-redteam-nearai missing"
  outlayer whoami 2>/dev/null | grep -q "$OWNER" && say "   outlayer CLI logged in as $OWNER" || die "outlayer CLI not logged in as $OWNER"
  say "   existing secret row for this hash: $(get_secret_row "$H")"
  exit 0
fi

# ---------------------------------------------------------------- 2. upload
say "2/6 FastFS upload"
fastfs_sha() { curl -s -m 60 "$URL" | shasum -a 256 | cut -c1-64; }
if [ "$(curl -s -o /dev/null -w '%{http_code}' -m 30 "$URL")" = "200" ] && [ "$(fastfs_sha)" = "$H" ]; then
  say "   already served by FastFS"
  UPLOAD_TX=$(cat "target/upload_tx_$H" 2>/dev/null || echo "previous")
else
  UPLOAD_TX=""
  for attempt in 1 2 3; do
    UPLOAD_TX=$(outlayer upload "$W" 2>&1 | grep -oE "tx: [1-9A-HJ-NP-Za-km-z]+" | awk '{print $2}' | head -1)
    [ -n "$UPLOAD_TX" ] || continue
    for _ in $(seq 1 12); do [ "$(tx_known "$UPLOAD_TX" "$OWNER")" = "yes" ] && break; sleep 5; done
    [ "$(tx_known "$UPLOAD_TX" "$OWNER")" = "yes" ] && break
    say "   upload tx $UPLOAD_TX was dropped by RPC, retrying ($attempt/3)"; UPLOAD_TX=""
  done
  [ -n "$UPLOAD_TX" ] || die "upload never landed on chain"
  mkdir -p target; echo "$UPLOAD_TX" > "target/upload_tx_$H"  # re-run scratch (ignored); the record goes to deployments/$H.json
  say "   tx $UPLOAD_TX; waiting for FastFS indexer"
  for _ in $(seq 1 40); do [ "$(curl -s -o /dev/null -w '%{http_code}' -m 30 "$URL")" = "200" ] && break; sleep 10; done
  [ "$(fastfs_sha)" = "$H" ] || die "FastFS does not serve the expected bytes at $URL"
fi
say "   $URL ✓ (sha256 verified)"

# ---------------------------------------------------------------- 3. secrets
say "3/6 TEE-generated enclave key + NEAR AI key (owner-only during bootstrap)"
ROW=$(get_secret_row "$H")
if [ "$ROW" = "null" ]; then
  outlayer secrets set "$(security find-generic-password -s near-redteam-nearai -a nearai -w | python3 -I -c 'import json,sys;print(json.dumps({"NEARAI_API_KEY":sys.stdin.read().strip()}))')" \
    --wasm-hash "$H" --profile "$PROFILE" --generate PROTECTED_ENCLAVE_KEY:hex32 --access allow-all --via "$OWNER" 2>&1 \
    | grep -E "^Secrets stored|rror" >&2
  # get_secrets at `final` can lag the store tx by a block or two
  for _ in $(seq 1 12); do ROW=$(get_secret_row "$H"); [ "$ROW" != "null" ] && break; sleep 3; done
  [ "$ROW" != "null" ] || die "secret row not stored"
else
  say "   row exists: $ROW"
fi
if echo "$ROW" | grep -q "\"$CALLER\""; then
  die "row is already locked to $CALLER; cannot run op:pubkey as owner (see deployments/$H.json)"
fi

# ---------------------------------------------------------------- 4. pubkey
say "4/6 op:pubkey via OutLayer (owner call)"
ARGS=$(python3 -I -c 'import json,sys;h,u,p,o=sys.argv[1:5];print(json.dumps({"source":{"WasmUrl":{"url":u,"hash":h,"build_target":"wasm32-wasip2"}},"resource_limits":{"max_instructions":10000000000,"max_memory_mb":256,"max_execution_seconds":60},"input_data":json.dumps({"op":"pubkey"}),"secrets_ref":{"profile":p,"account_id":o},"response_format":"Json","payer_account_id":o}))' "$H" "$URL" "$PROFILE" "$OWNER")
PUBKEY=""; PUBKEY_TX=""
for attempt in 1 2 3; do
  PUBKEY_TX=$(near_tx "$OUTLAYER" request_execution "$ARGS" '0.02 NEAR')
  [ -n "$PUBKEY_TX" ] || { say "   no tx id, retrying"; continue; }
  RES=$(tx_result "$PUBKEY_TX" "$OWNER")
  PUBKEY=$(echo "$RES" | python3 -I -c 'import json,sys
try: d=json.loads(sys.stdin.read()); print(d.get("enclave_pubkey") or "")
except Exception: print("")')
  [ ${#PUBKEY} = 64 ] && break
  say "   attempt $attempt: no pubkey ($RES), retrying"; PUBKEY=""
done
[ ${#PUBKEY} = 64 ] || die "could not obtain enclave pubkey"
say "   enclave_pubkey=$PUBKEY (tx $PUBKEY_TX)"

# ---------------------------------------------------------------- 5. lock
say "5/6 lock the key to Predecessor{$CALLER}"
LOCK=$(python3 -I -c 'import json,sys;h,p,c=sys.argv[1:4];print(json.dumps({"accessor":{"WasmHash":{"hash":h}},"profile":p,"new_access":{"Predecessor":{"condition":{"Whitelist":{"accounts":[c]}}}}}))' "$H" "$PROFILE" "$CALLER")
LOCK_TX=$(near_tx "$OUTLAYER" update_access "$LOCK" '0.01 NEAR')
ROW=$(get_secret_row "$H")
echo "$ROW" | python3 -I -c 'import json,sys;c=sys.argv[1];d=json.loads(sys.stdin.read());sys.exit(0 if d["access"]=={"Predecessor":{"condition":{"Whitelist":{"accounts":[c]}}}} else 1)' "$CALLER" \
  || die "lock not applied: $ROW"
say "   locked ✓ (tx $LOCK_TX)"

# ---------------------------------------------------------------- 6. record
say "6/6 record + pin"
mkdir -p deployments
python3 -I - "$H" "$URL" "$PUBKEY" "$VERSION" "$UPLOAD_TX" "$PUBKEY_TX" "$LOCK_TX" "$PROFILE" "$OWNER" "$CALLER" > "deployments/$H.json" <<'EOF'
import json,sys,datetime
h,u,pk,ver,up,pt,lt,prof,owner,caller=sys.argv[1:11]
print(json.dumps({
  "version": ver, "wasm_sha256": h, "url": u, "enclave_pubkey": pk,
  "deployed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
  "txs": {"fastfs_upload": up, "op_pubkey": pt, "lock": lt},
  "set_enclave": {"code": {"WasmUrl": {"url": u, "hash": h, "build_target": "wasm32-wasip2"}},
                  "enclave_pubkey": pk, "secrets_ref": {"profile": prof, "account_id": owner},
                  "resource_limits": {"max_instructions": 10000000000, "max_memory_mb": 256, "max_execution_seconds": 90}},
  "access": {"Predecessor": {"condition": {"Whitelist": {"accounts": [caller]}}}},
}, indent=2))
EOF
python3 -I - "$H" "$URL" "$PUBKEY" verify/verify.mjs <<'EOF'
import re,sys
h,u,pk,p=sys.argv[1:5]; s=open(p).read()
s=re.sub(r"wasm_sha256: '[0-9a-f]{64}'", f"wasm_sha256: '{h}'", s)
s=re.sub(r"url: 'https://test\.fastfs\.io/[^']+'", f"url: '{u}'", s)
s=re.sub(r"enclave_pubkey: '[0-9a-f]{64}'", f"enclave_pubkey: '{pk}'", s)
open(p,"w").write(s)
EOF
cat "deployments/$H.json"
say "done. Next: contract owner runs set_enclave with .set_enclave above; then delete the previous build's secret row."
