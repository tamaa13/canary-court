/**
 * `pnpm x25519 --out <file>` — new random x25519 keypair for Canary Court. The SECRET is written to <file>
 * (0600, never printed); the public key (64 hex) is printed: register it with `register_agent`. Reports for
 * you are ECIES-sealed to this key, so keep the file (losing it = losing your reports).
 */
import { existsSync } from 'node:fs';
import { x25519 } from '@noble/curves/ed25519.js';
import { hex, x25519PublicHex } from '../crypto/ecies.js';
import { arg, die, flag, writeSecretFile } from './ext-common.js';

const out = arg('out') ?? die('usage: pnpm x25519 --out <path/to/key.x25519> [--force]');
if (existsSync(out) && !flag('force')) die(`${out} exists (use --force to overwrite; old reports would become unreadable)`);
const sk = x25519.utils.randomSecretKey();
const path = writeSecretFile(out, hex.encode(sk) + '\n');
process.stdout.write(JSON.stringify({ x25519_pubkey: x25519PublicHex(sk), secret_file: path }, null, 2) + '\n');
