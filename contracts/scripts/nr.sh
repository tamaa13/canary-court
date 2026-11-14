#!/usr/bin/env bash
# Thin wrappers around near-cli-rs for the Canary Court testnet deployment (redteam / tusdc accounts).
#   source contracts/scripts/nr.sh
#   rt_call <signer> <method> '<json>' [deposit, default 0 NEAR] [gas, default 300 Tgas]
#   rt_view <method> '<json>'
#   tusdc_call <signer> <method> '<json>' [deposit] ; tusdc_view <method> '<json>'
# Keys come from ~/.near-credentials/testnet (legacy keychain). Testnet only.
export PATH="$HOME/.cargo/bin:/opt/homebrew/opt/rustup/bin:$PATH"
# near-cli-rs network profile. Default "testnet" = archival-rpc.testnet.fastnear.com; "testnet-fastnear" (test.rpc.fastnear.com) gets rate-limited under team load; rpc.testnet.near.org is deprecated
NET=${NET:-testnet}
RT=${RT:-redteam.arifnovrian.testnet}
TUSDC=${TUSDC:-tusdc.arifnovrian.testnet}

_call() { # contract signer method json deposit gas
  near contract call-function as-transaction "$1" "$3" json-args "$4" \
    prepaid-gas "${6:-300.0 Tgas}" attached-deposit "${5:-0 NEAR}" \
    sign-as "$2" network-config "$NET" sign-with-legacy-keychain send 2>&1 |
    grep -E "Transaction ID|panicked|Error|ERR_|EVENT_JSON|return value|^\s*[\"{\[0-9tf]" | grep -v "^\s*$"
}
_view() { # contract method json
  near contract call-function as-read-only "$1" "$2" json-args "$3" network-config "$NET" now 2>&1 |
    sed -n '/return value/,$p' | grep -vE "return value|console command|near contract|^\s*$"
}
rt_call()    { _call "$RT" "$1" "$2" "$3" "${4:-}" "${5:-}"; }
rt_view()    { _view "$RT" "$1" "$2"; }
tusdc_call() { _call "$TUSDC" "$1" "$2" "$3" "${4:-}" "${5:-50.0 Tgas}"; }
tusdc_view() { _view "$TUSDC" "$1" "$2"; }
