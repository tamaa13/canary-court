#!/usr/bin/env node
// Canary Court: measure OutLayer's execution queue WITHOUT spending fees
// (NEAR RPC view calls only). Use it to pick a quiet moment for live runs.
//
//   node enclave/tools/outlayer-queue.mjs                 # one snapshot (exit 0 = QUIET)
//   node enclave/tools/outlayer-queue.mjs --watch 300     # watch 5 min: completion latencies + timeouts
//   OUTLAYER_NETWORK=mainnet node ...                     # default testnet
//
// How: outlayer.get_stats()[0] counts finished requests; ids around it are the ones
// still in flight. get_request(id) returns a pending request (with its request
// timestamp) or null once its callback ran. (get_pending_request_ids is unusable:
// it scans every id since genesis and runs out of view gas.) A request is lost when
// no worker resolves it within NEAR's yield window: 200 blocks ≈ 115 s on testnet.
// Public RPCs rate-limit hard, so calls rotate across endpoints and watch mode only
// re-checks known ids plus the ids just above the newest one.

const NET = process.env.OUTLAYER_NETWORK === 'mainnet'
  ? { rpcs: ['https://rpc.mainnet.fastnear.com', 'https://free.rpc.fastnear.com', 'https://rpc.mainnet.near.org'], contract: 'outlayer.near' }
  : { rpcs: ['https://rpc.testnet.fastnear.com', 'https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org', 'https://near-testnet.drpc.org'], contract: 'outlayer.testnet' };
const YIELD_S = 114.7; // measured on testnet (200 blocks)
const BELOW = 12, ABOVE = 20, CONC = 4, POLL_S = 10;
let rr = 0;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function view(method, args) {
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'query',
    params: {
      request_type: 'call_function', finality: 'optimistic', account_id: NET.contract, method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    },
  });
  let last;
  for (let attempt = 0; attempt < 2 * NET.rpcs.length; attempt++) {
    const url = NET.rpcs[rr++ % NET.rpcs.length];
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
      const r = await res.json();
      if (!r.result) throw new Error(`${new URL(url).host} ${res.status}: ${JSON.stringify(r.error ?? r).slice(0, 80)}`);
      if (r.result.error) throw new Error(r.result.error);
      return JSON.parse(Buffer.from(r.result.result).toString());
    } catch (e) {
      last = e;
      await sleep(200 * (attempt + 1));
    }
  }
  throw last;
}

async function getMany(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += CONC) {
    out.push(...(await Promise.all(ids.slice(i, i + CONC).map((id) => view('get_request', { request_id: id }).then((r) => [id, r])))));
  }
  return out;
}

const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);
const rec = (id, r) => ({ id, ts: r.timestamp / 1e9, sender: r.sender_id });

/** Full scan around the head of the queue: Map id → {id, ts, sender} */
async function scan() {
  const [finished] = await view('get_stats', {});
  let hi = finished + ABOVE;
  const out = new Map();
  for (const [id, r] of await getMany(range(finished - BELOW, hi))) if (r) out.set(id, rec(id, r));
  while ([...out.keys()].some((id) => id >= hi - 5) && hi - finished < 300) {
    for (const [id, r] of await getMany(range(hi, hi + ABOVE))) if (r) out.set(id, rec(id, r));
    hi += ABOVE;
  }
  return out;
}

const withAges = (m) => {
  const now = Date.now() / 1000;
  return [...m.values()].sort((a, b) => a.id - b.id).map((p) => ({ id: p.id, age_s: +(now - p.ts).toFixed(1), sender: p.sender }));
};

function verdict(list) {
  const oldest = list.reduce((m, p) => Math.max(m, p.age_s), 0);
  if (oldest >= 0.85 * YIELD_S) return { level: 'DANGER', why: `oldest request ${oldest}s old, timeout at ~${YIELD_S}s: new requests will likely time out` };
  if (oldest >= 45 || list.length >= 4) return { level: 'BUSY', why: `${list.length} in flight, oldest ${oldest}s` };
  return { level: 'QUIET', why: `${list.length} in flight, oldest ${oldest}s` };
}

const pct = (xs, q) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : null);

const watchIdx = process.argv.indexOf('--watch');
if (watchIdx < 0) {
  const list = withAges(await scan());
  const v = verdict(list);
  console.log(JSON.stringify({ network: NET.contract, at: new Date().toISOString(), in_flight: list.length, verdict: v.level, why: v.why, pending: list }, null, 2));
  process.exit(v.level === 'QUIET' ? 0 : 1);
}

const dur = Number(process.argv[watchIdx + 1] || 300);
const end = Date.now() + dur * 1000;
const latencies = [];
let timeouts = 0, pend = null, maxId = 0;
console.error(`watching ${NET.contract} for ${dur}s (poll ${POLL_S}s, RPC views only, no fees)`);
while (Date.now() < end) {
  const t = Date.now() / 1000;
  try {
    if (!pend) {
      pend = await scan();
      maxId = Math.max(maxId, ...pend.keys(), (await view('get_stats', {}))[0]);
    } else {
      // re-check known pending ids
      for (const [id, r] of await getMany([...pend.keys()])) {
        if (r) continue;
        const p = pend.get(id); pend.delete(id);
        const lat = +(t - p.ts).toFixed(1);
        if (lat >= YIELD_S - POLL_S) { timeouts++; console.log(`${new Date().toISOString()} #${id} ${p.sender}: LIKELY TIMEOUT (${lat}s)`); }
        else { latencies.push(lat); console.log(`${new Date().toISOString()} #${id} ${p.sender}: done in ≤${lat}s`); }
      }
      // discover new requests just above the newest one seen (stop after 3 consecutive empty ids)
      let id = maxId + 1, misses = 0;
      while (misses < 3) {
        const r = await view('get_request', { request_id: id });
        if (r) { pend.set(id, rec(id, r)); maxId = id; misses = 0; } else misses++;
        id++;
      }
    }
    const v = verdict(withAges(pend));
    console.error(`${new Date().toISOString()} in_flight=${pend.size} ${v.level} (${v.why})`);
  } catch (e) {
    console.error(`${new Date().toISOString()} poll failed (${String(e.message).slice(0, 80)}), retrying`);
  }
  await sleep(POLL_S * 1000);
}
console.log(JSON.stringify({ network: NET.contract, watched_s: dur, completed: latencies.length, timeouts,
  latency_s: { p50: pct(latencies, 0.5), p90: pct(latencies, 0.9), max: latencies.length ? Math.max(...latencies) : null } }, null, 2));
