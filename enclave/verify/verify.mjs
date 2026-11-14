#!/usr/bin/env node
// near-redteam enclave verifier: everything the "Verified" panel shows, checked
// against public sources only (NEAR RPC, nearblocks, FastFS, NEAR AI Cloud).
// Isomorphic: runs in Node >= 20 and in the browser (fetch + CORS are open on
// every endpoint used). See ../ATTESTATION.md for what each check proves.
//
//   node verify.mjs enclave                       # code hash, key custody, pubkey
//   node verify.mjs finding <tx_hash> <signer>    # one submit_finding tx end-to-end
//   node verify.mjs model <model_id> [address]    # NEAR AI fresh-nonce attestation
//
// Each check: {id, label, ok: true|false|null, detail}. ok=null means "not
// applicable / could not be determined" (e.g. mock mode, indexer lag).

import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

export const TESTNET = {
  rpc: 'https://rpc.testnet.fastnear.com',
  nearblocks: 'https://api-testnet.nearblocks.io/v1',
  nearai: 'https://cloud-api.near.ai/v1',
  outlayer: 'outlayer.testnet',
  worker: 'worker.outlayer.testnet',
  redteam: 'redteam.arifnovrian.testnet',
  secretsOwner: 'arifnovrian.testnet',
  secretsProfile: 'enclave',
  // Published in enclave/DEPLOYMENTS.md; used when get_config is unavailable
  // and as a pin to compare the contract's config against.
  expected: {
    wasm_sha256: 'c1b1ac5cd1a270880554a321f2a6736858fdac1b00964763f71c26498f0d0cdf',
    url: 'https://test.fastfs.io/arifnovrian.testnet/outlayer.testnet/c1b1ac5cd1a270880554a321f2a6736858fdac1b00964763f71c26498f0d0cdf.wasm',
    enclave_pubkey: '091e7c1b45f635f3015ce7dff55fdbc0944f52abf7190f7b8dd0e7b572d5e542',
  },
};

const RESOLVE_METHODS = ['resolve_execution', 'submit_execution_output_and_resolve'];

// ---------- small utils ----------
const check = (id, label, ok, detail = '') => ({ id, label, ok, detail });
const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesToB64 = (b) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(''));
const b64ToStr = (s) => new TextDecoder().decode(b64ToBytes(s));
const strip0x = (h) => (h.startsWith('0x') ? h.slice(2) : h).toLowerCase();
const short = (s, n = 10) => (typeof s === 'string' && s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-6)}` : s);
const allOk = (checks) => checks.every((c) => c.ok !== false);

async function rpc(cfg, method, params) {
  const r = await fetch(cfg.rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error.cause || j.error)}`);
  return j.result;
}

export async function view(cfg, account, method, args = {}) {
  const res = await rpc(cfg, 'query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: account,
    method_name: method,
    args_base64: bytesToB64(utf8ToBytes(JSON.stringify(args))),
  });
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(res.result)));
}

/** Accepts {"WasmUrl":{...}} or {"type":"WasmUrl",...} or a JSON string of either. */
function wasmUrlOf(code) {
  if (typeof code === 'string') {
    try { code = JSON.parse(code); } catch { return null; }
  }
  if (!code || typeof code !== 'object') return null;
  if (code.WasmUrl) return code.WasmUrl;
  if (code.wasm_url) return code.wasm_url;
  if (code.url && code.hash) return code;
  return null;
}

// ---------- 1+2: enclave code & key custody ----------
export async function verifyEnclave(cfg = TESTNET, { fetchWasm = true } = {}) {
  const checks = [];
  let hash = cfg.expected.wasm_sha256, url = cfg.expected.url, pubkey = cfg.expected.enclave_pubkey;
  try {
    const conf = await view(cfg, cfg.redteam, 'get_config');
    const w = wasmUrlOf(conf.enclave_code);
    if (w) { hash = String(w.hash).toLowerCase(); url = w.url; }
    if (conf.enclave_pubkey) pubkey = String(conf.enclave_pubkey).toLowerCase();
    checks.push(check('config.code', 'Contract enclave_code = published build',
      hash === cfg.expected.wasm_sha256, `sha256 ${short(hash)} (${cfg.redteam}.get_config)`));
    checks.push(check('config.pubkey', 'Contract enclave_pubkey = key produced by op:pubkey',
      pubkey === cfg.expected.enclave_pubkey, short(pubkey)));
  } catch (e) {
    checks.push(check('config', `Read ${cfg.redteam}.get_config`, null, `unavailable (${e.message}); using published values`));
  }

  if (fetchWasm) {
    try {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const got = bytesToHex(sha256(bytes));
      checks.push(check('code.bytes', 'Hosted wasm bytes hash to enclave_code.hash', got === hash,
        `${bytes.length} bytes from FastFS → ${short(got)}`));
    } catch (e) {
      checks.push(check('code.bytes', 'Hosted wasm bytes hash to enclave_code.hash', false, e.message));
    }
  }

  try {
    const row = await view(cfg, cfg.outlayer, 'get_secrets', {
      accessor: { WasmHash: { hash } }, profile: cfg.secretsProfile, owner: cfg.secretsOwner,
    });
    const boundHash = row?.accessor?.WasmHash?.hash;
    checks.push(check('key.bound', 'Enclave key readable only by this exact wasm', boundHash === hash,
      row ? `accessor WasmHash ${short(boundHash)}` : 'no secret row for this hash'));
    const want = { Predecessor: { condition: { Whitelist: { accounts: [cfg.redteam] } } } };
    const okLock = JSON.stringify(row?.access) === JSON.stringify(want);
    checks.push(check('key.locked', `Only calls via ${cfg.redteam} unlock the key`, okLock,
      `access ${JSON.stringify(row?.access)}; updated ${row ? new Date(Number(BigInt(row.updated_at) / 1000000n)).toISOString() : '-'}`));
  } catch (e) {
    checks.push(check('key', 'Read outlayer.get_secrets', false, e.message));
  }
  return { ok: allOk(checks), checks, enclave: { wasm_sha256: hash, url, enclave_pubkey: pubkey } };
}

// ---------- 3+4: one finding's OutLayer execution ----------
function outlayerEvents(txResult, outlayer) {
  const ev = {};
  for (const ro of txResult.receipts_outcome) {
    if (ro.outcome.executor_id !== outlayer) continue;
    for (const l of ro.outcome.logs) {
      if (!l.startsWith('EVENT_JSON:')) continue;
      try {
        const e = JSON.parse(l.slice(11));
        if (e.standard?.startsWith('near-outlayer')) ev[e.event] = { ...e.data[0], receipt_id: ro.id };
      } catch { /* not ours */ }
    }
  }
  return ev;
}

function moduleOutput(txResult, outlayer) {
  for (const ro of txResult.receipts_outcome) {
    const sv = ro.outcome.status?.SuccessValue;
    if (ro.outcome.executor_id !== outlayer || !sv) continue;
    try {
      const v = JSON.parse(b64ToStr(sv));
      if (v && typeof v === 'object' && v.v === 1) return v;
    } catch { /* not JSON */ }
  }
  return null;
}

/** Locate the TEE worker's resolve tx for request_id (nearblocks cursor = timestamp). */
export async function findResolveTx(cfg, requestId, completedTsNs) {
  const cursor = btoa(JSON.stringify({ index: 0, shard: 0, timestamp: String(BigInt(completedTsNs) + 1n) }));
  for (const method of RESOLVE_METHODS) {
    const u = `${cfg.nearblocks}/account/${cfg.worker}/txns-only?per_page=25&method=${method}&cursor=${encodeURIComponent(cursor)}`;
    const d = await (await fetch(u, { headers: { Accept: 'application/json' } })).json();
    for (const t of d.txns || []) {
      if (BigInt(completedTsNs) - BigInt(t.block_timestamp) > 180_000_000_000n) break;
      const tx = (await rpc(cfg, 'tx', { tx_hash: t.transaction_hash, sender_account_id: cfg.worker, wait_until: 'NONE' })).transaction;
      const args = JSON.parse(b64ToStr(tx.actions[0].FunctionCall.args));
      if (args.request_id === requestId) return { tx_hash: t.transaction_hash, public_key: tx.public_key, method };
    }
  }
  return null;
}

export async function verifyFinding(cfg = TESTNET, txHash, signerId, { expectHash, expectPredecessor, resolveWorker = true } = {}) {
  const checks = [];
  const tx = await rpc(cfg, 'EXPERIMENTAL_tx_status', { tx_hash: txHash, sender_account_id: signerId, wait_until: 'FINAL' });
  const ev = outlayerEvents(tx, cfg.outlayer);
  const req = ev.execution_requested ? JSON.parse(ev.execution_requested.request_data) : null;
  const done = ev.execution_completed || null;
  const output = moduleOutput(tx, cfg.outlayer);
  const hash = expectHash || cfg.expected.wasm_sha256;
  const pred = expectPredecessor || cfg.redteam;

  checks.push(check('exec.requested', 'OutLayer execution requested in this tx', !!req,
    req ? `request_id ${req.request_id}, signer ${req.sender_id}` : 'no execution_requested event'));
  if (req) {
    const w = wasmUrlOf(req.code_source);
    checks.push(check('exec.code', 'Ran the published enclave build', w?.hash === hash, `code_source sha256 ${short(w?.hash)}`));
    checks.push(check('exec.caller', `Requested by ${pred} (unlocks the key)`, req.predecessor_id === pred, `predecessor ${req.predecessor_id}`));
    checks.push(check('exec.secrets', 'With the enclave secret profile', req.secrets_ref?.profile === cfg.secretsProfile && req.secrets_ref?.account_id === cfg.secretsOwner,
      JSON.stringify(req.secrets_ref)));
  }
  checks.push(check('exec.completed', 'Execution completed in the TEE worker', done ? done.success === true : null,
    done ? `success=${done.success}, ${done.resources_used?.time_ms} ms, charged ${done.payment_charged} yN${done.error_message ? `, error: ${done.error_message}` : ''}` : 'no execution_completed event (timeout?)'));
  checks.push(check('exec.output', 'Module output returned on-chain', !!output,
    output ? `valid=${output.valid} severity=${output.severity} manipulation=${output.manipulation} error=${output.error} llm=${output.llm}` : 'no module output in receipts'));

  let worker = null;
  if (resolveWorker && req && done) {
    try {
      worker = await findResolveTx(cfg, req.request_id, done.timestamp);
      if (!worker) {
        checks.push(check('worker.tee', 'Result posted by a TDX-attested worker key', null, 'resolve tx not found in indexer window'));
      } else {
        const k = await rpc(cfg, 'query', { request_type: 'view_access_key', finality: 'final', account_id: cfg.worker, public_key: worker.public_key });
        const fc = k.permission?.FunctionCall;
        const ok = !!fc && fc.receiver_id === cfg.outlayer && RESOLVE_METHODS.every((m) => fc.method_names.includes(m));
        checks.push(check('worker.tee', 'Result posted by a TDX-attested worker key', ok,
          `${worker.method} tx ${short(worker.tx_hash, 8)} signed by ${worker.public_key.split(':')[0]} key ${ok ? '(function-call key added by register-contract after TDX quote check)' : JSON.stringify(k.permission)}`));
      }
    } catch (e) {
      checks.push(check('worker.tee', 'Result posted by a TDX-attested worker key', null, e.message));
    }
  }

  const sigs = output?.model_signatures || [];
  if (output && (output.error || output.manipulation)) {
    // No model was called: errors stop before the target runs, and manipulation
    // voids the finding before the target runs. On error outputs `llm` only
    // says whether a NEAR AI key is configured.
    checks.push(check('model.sigs', 'Model TEE signature', null,
      output.error ? `error ${output.error}: no model call` : 'manipulation: target not called'));
  } else if (output?.llm === 'live') {
    checks.push(check('model.sigs', 'NEAR AI signed every attempt', sigs.length > 0, `${sigs.length} signature(s), model ${output.model}`));
    for (const [i, s] of sigs.entries()) {
      const r = verifyModelSignature(s, output.model);
      checks.push(check(`model.sig${i}`, `Attempt ${i + 1}: model TEE signature`, r.ok, r.detail));
    }
  } else if (output) {
    checks.push(check('model.sigs', 'Model TEE signature', null, `llm=${output.llm} (mock target: no model)`));
  }
  return { ok: allOk(checks), checks, request: req, completed: done, output, worker };
}

// ---------- 5: NEAR AI model TEE ----------
/** EIP-191 personal_sign recovery → 0x address (lowercase). */
export function recoverEip191(text, signatureHex) {
  const sig = hexToBytes(strip0x(signatureHex));
  if (sig.length !== 65) throw new Error(`signature length ${sig.length}`);
  let v = sig[64];
  if (v >= 27) v -= 27;
  const msg = utf8ToBytes(text);
  const digest = keccak_256(new Uint8Array([...utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`), ...msg]));
  const pub = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v).recoverPublicKey(digest).toRawBytes(false);
  return '0x' + bytesToHex(keccak_256(pub.slice(1)).slice(-20));
}

export function verifyModelSignature(s, model) {
  try {
    const addr = recoverEip191(s.text, s.signature);
    const okAddr = addr === s.signing_address.toLowerCase();
    const okModel = !model || s.text.startsWith(`${model}:`);
    return {
      ok: okAddr && s.bound === true && okModel,
      recovered: addr,
      detail: `ecrecover → ${short(addr, 8)} ${okAddr ? '=' : '≠'} signing_address; in-enclave binding ${s.bound ? 'OK' : 'MISSING'}; chat ${short(s.chat_id, 6)}`,
    };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

export async function verifyModelAttestation(cfg = TESTNET, model, expectAddress, nonceHex) {
  const checks = [];
  const nonce = nonceHex || bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const u = `${cfg.nearai}/attestation/report?model=${encodeURIComponent(model)}&nonce=${nonce}&signing_algo=ecdsa`;
  const rep = await (await fetch(u)).json();
  const list = rep.model_attestations || [];
  const m = list.find((a) => a.model_name === model) || list[0];
  if (!m) return { ok: false, nonce, checks: [check('model.att', 'Model attestation report', false, 'no model_attestations')] };
  const addr = m.signing_address.toLowerCase();
  checks.push(check('att.nonce', 'Fresh nonce echoed by the model TEE', m.request_nonce === nonce, `nonce ${short(nonce, 8)}`));
  if (expectAddress) {
    checks.push(check('att.addr', 'Attested signing key = key that signed our response', addr === expectAddress.toLowerCase(), short(addr, 8)));
  }
  try {
    const q = hexToBytes(m.intel_quote);
    const rd = bytesToHex(q.slice(568, 632)); // TDX quote v4: header 48 + TD report body, report_data = last 64 bytes
    const want = strip0x(addr) + '00'.repeat(12) + nonce;
    checks.push(check('att.tdx', 'Intel TDX quote binds signing key + nonce (report_data)', rd === want,
      `quote ${q.length} bytes, report_data ${short(rd, 8)}`));
  } catch (e) {
    checks.push(check('att.tdx', 'Intel TDX quote binds signing key + nonce', false, e.message));
  }
  try {
    const nv = typeof m.nvidia_payload === 'string' ? JSON.parse(m.nvidia_payload) : m.nvidia_payload;
    checks.push(check('att.gpu', 'NVIDIA GPU evidence bound to the nonce', nv?.nonce === nonce && (nv?.evidence_list?.length || 0) > 0,
      `${nv?.evidence_list?.length || 0} GPU evidence(s), arch ${nv?.arch}`));
  } catch (e) {
    checks.push(check('att.gpu', 'NVIDIA GPU evidence bound to the nonce', false, e.message));
  }
  checks.push(check('att.external', 'Quote/GPU signature chains (Intel DCAP, NVIDIA NRAS)', null,
    'not verified here; submit intel_quote / nvidia_payload to an external verifier'));
  return {
    ok: allOk(checks),
    nonce,
    checks,
    report: { signing_address: addr, model_name: m.model_name, os_image_hash: m.info?.os_image_hash, compose_hash: m.info?.compose_hash },
  };
}

// ---------- CLI ----------
const isMain = typeof process !== 'undefined' && process.argv?.[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const [cmd, a, b] = process.argv.slice(2);
  let out;
  try {
    if (cmd === 'enclave') out = await verifyEnclave(TESTNET);
    else if (cmd === 'finding' && a && b) {
      out = await verifyFinding(TESTNET, a, b);
      const live = out.output?.llm === 'live' && out.output.model_signatures?.[0];
      if (live) out.model_attestation = await verifyModelAttestation(TESTNET, out.output.model, live.signing_address);
      out.ok = out.ok && (!out.model_attestation || out.model_attestation.ok);
    } else if (cmd === 'model' && a) out = await verifyModelAttestation(TESTNET, a, b);
    else {
      console.error('usage: verify.mjs enclave | finding <tx_hash> <signer_account> | model <model_id> [signing_address]');
      process.exit(2);
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}
