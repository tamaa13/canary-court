#!/usr/bin/env bash
# Reproducible build of the enclave module.
#   ./build.sh  → target/wasm32-wasip2/release/redteam-enclave.wasm + its sha256
# Toolchain is pinned by rust-toolchain.toml (1.88.0), deps by Cargo.lock.
# Local paths are remapped so the sha256 does not depend on who builds it.
set -euo pipefail
cd "$(dirname "$0")"
CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"
export RUSTFLAGS="--remap-path-prefix=${CARGO_HOME_DIR}=/cargo --remap-path-prefix=$(pwd)=/enclave --remap-path-prefix=$(rustc --print sysroot)=/rustc"
cargo build --locked --target wasm32-wasip2 --release
W=target/wasm32-wasip2/release/redteam-enclave.wasm
if command -v sha256sum >/dev/null; then sha256sum "$W"; else shasum -a 256 "$W"; fi
