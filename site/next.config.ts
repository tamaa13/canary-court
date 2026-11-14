import path from "node:path";
import type { NextConfig } from "next";

// The app reads two files that live beside site/ in the repo: rt-agents' attack receipts (agents/fixtures) and
// rt-enclave's isomorphic verifier (enclave/verify/verify.mjs). Turbopack only resolves files under its root, so the
// root is the repo. verify.mjs imports noble v1 paths; the site uses noble v2, so those four paths are aliased to the
// v1 copies installed as noble-curves-v1 / noble-hashes-v1.
const repo = path.resolve(import.meta.dirname, "..");
// (relative alias targets resolve from this folder, not from the root)
const v1 = (p: string) => `./node_modules/${p}`;

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  outputFileTracingRoot: repo,
  turbopack: {
    root: repo,
    resolveAlias: {
      "@enclave/verify": "../enclave/verify/verify.mjs",
      "@noble/curves/secp256k1": v1("noble-curves-v1/secp256k1.js"),
      "@noble/hashes/sha3": v1("noble-hashes-v1/sha3.js"),
      "@noble/hashes/sha256": v1("noble-hashes-v1/sha256.js"),
      "@noble/hashes/utils": v1("noble-hashes-v1/utils.js"),
    },
  },
  images: { formats: ["image/avif", "image/webp"] },
};

export default config;
