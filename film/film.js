/* Canary Court · demo film v4 (a playback page; no video render until the cut is final).
 *
 * One timeline drives everything. render(t) is a pure function of t (seconds), so playing, scrubbing, seeking and the
 * capture mode all show the same frame for the same t:
 *   index.html                      review: play/pause, scrubber, keys, cue list
 *   index.html?capture=1&t=41.5     one frame, no chrome (stage at 1920×1080); window.filmSeek(t) for frame-by-frame capture
 * Every timing lives in the CUE TABLE and SHOTS below. The music (audio/score.mp3, rt-3d) follows the same seconds:
 * open 0 · pulse 14 · build 22 · hold 38 · warm 42 · lift 70 · resolve 76 · end 85.
 */
'use strict';

// ════════════════════════════════════════════════════════════════════════ CUE TABLE (seconds)
const DURATION = 85;

const CONFIG = {
  // '' = same origin: serve.mjs proxies the site, so the film can scroll its pages and aim at their text.
  // 'http://localhost:3100' also works, but cross-origin: no scrolling, the camera uses the fallback coordinates.
  site: '',
  // the public address, shown in /join's sentence and (without https://) on the end card. A placeholder (facts.ts
  // SITE_URL's default) until the real domain is known at deploy: this is the only place to change it.
  host: 'https://canary-court.vercel.app',
  audio: 'audio/score.mp3',
  clipCredits: true, // a small source line on each news clip (outlet, speaker)
  duck: 0.4, // the score's level under a clip's speech (−8 dB)
};

// News clips (0:04–0:14): excerpts cut on word boundaries (clips/, not committed; sources in CREDITS.md). Each is the
// speaker's own words, a whole phrase that keeps its meaning. src: an mp4 in film/clips/ (shown in black and white, with
// its sound under the score); words: [seconds into the clip, the caption shown from then on]; credit: the line on screen.
const CLIPS = [
  { src: 'clips/m1-coinbase.mp4', credit: 'Coinbase · Brian Armstrong, CEO', words: [[0.1, 'we gave agents'], [1.16, 'their own financial accounts']] },
  { src: 'clips/m2-visa.mp4', credit: 'Bloomberg Tech · Ryan McInerney, CEO, Visa', words: [[0.03, 'to go make payments'], [0.93, 'on your behalf']] },
  { src: 'clips/m3-anthropic.mp4', credit: 'Anthropic · Claude ran a business in our office', words: [[0.07, 'fool Claudius or trick Claudius'], [1.54, 'into doing various things']] },
  { src: 'clips/m4-deepmind.mp4', credit: 'Google DeepMind · Four Flynn', words: [[0.0, 'hijack the thought process'], [1.34, 'of the LLM']] },
];

// The wall (16.9–22 s): muted excerpts that loop as tiles (then the four clips above, muted). Empty = CLIPS are reused.
const WALL = [
  { src: 'clips/w1-wsj.mp4' },
  { src: 'clips/w2-cnbc-vending.mp4' },
  { src: 'clips/w4-microsoft.mp4' },
  { src: 'clips/w5-ted-altman.mp4' },
  { src: 'clips/w6-crowdstrike.mp4' },
  { src: 'clips/w7-60min.mp4' },
  { src: 'clips/w8-cnbc-crypto.mp4' },
  { src: 'clips/w3-cnbc-vending2.mp4' },
  { src: 'clips/m1-coinbase.mp4' },
  { src: 'clips/m2-visa.mp4' },
  { src: 'clips/m3-anthropic.mp4' },
  { src: 'clips/m4-deepmind.mp4' },
];

// _word_ is underlined. Text cues: words rise in one by one, the card fades out over its last `out` seconds.
const CUES = [
  { id: 'wallets', at: 0.0, end: 4.1, scene: 'text', text: 'AI agents are getting wallets.', in: 0.5 },
  { id: 'news-1', at: 4.1, end: 6.76, scene: 'clip', clip: 0 }, // each clip's cue = its length (clips/clips.json)
  { id: 'news-2', at: 6.76, end: 8.67, scene: 'clip', clip: 1 },
  { id: 'news-3', at: 8.67, end: 11.56, scene: 'clip', clip: 2 },
  { id: 'news-4', at: 11.56, end: 14.0, scene: 'clip', clip: 3 },
  { id: 'keys', at: 14.0, end: 16.9, scene: 'text', text: 'And the _keys_ to them.' },
  { id: 'wall', at: 16.9, end: 22.0, scene: 'wall', tiles: 16 },
  { id: 'invoice', at: 22.0, end: 28.0, scene: 'text', text: 'One poisoned invoice can make an agent hand them over.' },
  { id: 'before', at: 28.0, end: 34.0, scene: 'text', text: 'Nobody tests that _before_ the money arrives.' },
  { id: 'court', at: 34.0, end: 38.0, scene: 'text', text: 'So we built a court for it.' },
  // the lone mark, then it falls into its slot: the mark in the site's header, as the product card appears around it
  { id: 'mark', at: 38.0, end: 42.0, scene: 'mark', fly: 40.15, land: 41.45 },
  { id: 'product', at: 41.0, end: 70.0, scene: 'product', fadeIn: [41.1, 41.75], fadeOut: [69.35, 70.0] },
  {
    id: 'proof', at: 70.0, end: 76.0, scene: 'proof',
    items: [
      ['21/21', 'attack expectations held, scenarios S1–S5'],
      ['54', 'end-to-end steps on testnet: 53 passed, 1 not exercised'],
      ['0', "plaintext secrets in the final run's 47 views and logs"],
    ],
  },
  { id: 'built', at: 76.0, end: 79.7, scene: 'text', text: 'Built on NEAR.', sub: 'NEAR testnet · a fictional treasury agent' },
  { id: 'lockup', at: 79.7, end: 85.0, scene: 'lockup', tagAt: 81.3, tagline: 'Give AI money. Not the keys.' },
];

// The product (41–70 s) is a FLOW of real actions on the real site, in a floating card: each beat is one change you can
// see. The pointer clicks "I have an agent" → the site's way through its 3D film into /join → Copy → the agent runs
// (terminal) → the market: type the agent's account, Follow → its job: the timeline replays to the verdict and the payout
// → the sealed report.
//
// PAGES: the site's pages in the card, each its own preloaded frame (served same-origin by serve.mjs).
const AGENT = 'cc-mcp-fb0e07.testnet'; // the fresh agent from agents/fixtures/mcp-proof.json (run by our team)
const PAGES = {
  home: '/?capture=1', // the site's capture mode: the 3D story follows the scroll with no lag (window.__cc.storyAt)
  join: '/join',
  app: '/app', // the market before Follow (the pointer types into "Your agent")
  appMine: '/app', // the same page, loaded already following AGENT: what Follow shows
  job: '/app/jobs/110', // the job AGENT won: Tilly (live model), 10 tUSDC, 5 per leak → Valid, paid 5
};
// SHOTS: camera keyframes. Between two shots of one page the camera eases; a new page is a cut at its first shot.
//   f:      the point at the centre of the frame, [x, y] in document px, or A(text, dx, dy, fallback) = a line of text
//   scroll: the page's own scroll (number or S(text, top)); story: on home, the 3D story's position in screens (it scrolls
//           the page; f is then in viewport px). pull: the site's words pull back (0–1). night: the dark (0–1)
//   z:      zoom; 1 shows the whole 1440×900 viewport in the card. spot: a line whose row stays lit while the page dims
//   page 'term' is the terminal card (no site page)
const A = (text, dx = 0, dy = 0, fb = [720, 450]) => ({ text, dx, dy, fb });
const S = (text, top, fb = 0) => ({ text, top, fb });
const WHOLE = [720, 450];
const SHOTS = [
  // 1 · the hero, live: the card arrives as the mark lands in the header
  { t: 41.0, page: 'home', story: 0, f: WHOLE, z: 1 },
  { t: 41.9, page: 'home', story: 0, f: WHOLE, z: 1 },
  { t: 42.7, page: 'home', story: 0, f: [600, 470], z: 1.25 },
  // 2 · "I have an agent": the words pull back, the film runs key → vault → three-quarters, the camera dives into the dark
  { t: 42.8, page: 'home', story: 0, pull: 0, f: [600, 470], z: 1.25 },
  { t: 43.35, page: 'home', story: 0.4, pull: 1, f: [1008, 450], z: 1.35 },
  { t: 44.0, page: 'home', story: 1.0, pull: 1, f: [1008, 450], z: 1.4 }, // the key in its lock
  { t: 44.85, page: 'home', story: 1.62, pull: 1, f: [1000, 450], z: 1.4 }, // the vault, from above
  { t: 45.85, page: 'home', story: 2.9, pull: 1, f: [1000, 450], z: 1.45 }, // the vault turns to three-quarters
  { t: 46.45, page: 'home', story: 2.9, pull: 1, f: [990, 470], z: 4.8, night: 1 }, // into the vault's dark
  // 3 · /join emerges from the dark; the pointer copies the sentence
  { t: 46.45, page: 'join', f: WHOLE, z: 0.96, night: 1, cut: 0 },
  { t: 46.85, page: 'join', f: WHOLE, z: 1, night: 0 },
  { t: 47.1, page: 'join', f: WHOLE, z: 1 },
  { t: 48.0, page: 'join', f: A('and follow it to join', -20, 24, [500, 544]), z: 2.15, spot: 'and follow it to join' },
  { t: 50.0, page: 'join', f: A('and follow it to join', -10, 24, [510, 544]), z: 2.2, spot: 'and follow it to join' },
  // 4 · the agent runs (see TERMINAL)
  { t: 50.0, page: 'term' },
  // 5 · the market: type the agent's account, Follow → its card fills in
  { t: 57.0, page: 'app', f: WHOLE, z: 1 },
  { t: 57.7, page: 'app', f: [490, 455], z: 2.0 },
  { t: 59.35, page: 'app', f: [490, 455], z: 2.0 },
  { t: 59.35, page: 'appMine', f: [490, 455], z: 2.0, cut: 0.15 },
  { t: 60.2, page: 'appMine', f: [490, 455], z: 2.0 },
  { t: 60.8, page: 'appMine', f: [640, 560], z: 1.62 }, // down to Live now: Tilly
  // 6 · its job: the timeline replays (see REPLAY) to the verdict and the payout
  { t: 61.1, page: 'job', scroll: 420, f: [720, 870], z: 1, cut: 0.3 },
  { t: 61.6, page: 'job', scroll: 420, f: [660, 840], z: 1.45 },
  { t: 62.9, page: 'job', scroll: 420, f: [660, 842], z: 1.46 },
  { t: 63.7, page: 'job', scroll: 420, f: [680, 872], z: 1.3 }, // steps and the whole timeline in one frame
  { t: 64.6, page: 'job', scroll: 420, f: [680, 874], z: 1.3 },
  { t: 65.4, page: 'job', scroll: 420, f: [960, 1060], z: 1.85 }, // the verdict line and the money
  { t: 66.7, page: 'job', scroll: 420, f: [965, 1066], z: 1.88 },
  // 7 · the report, sealed for the owner
  { t: 67.6, page: 'job', scroll: 700, f: A('Report sealed for the', 60, -14, [1100, 1295]), z: 3.0, spot: { text: 'Report sealed for the', minW: 480, minH: 44 } },
  { t: 70.0, page: 'job', scroll: 700, f: A('Report sealed for the', 66, -14, [1106, 1295]), z: 3.05, spot: { text: 'Report sealed for the', minW: 480, minH: 44 } },
];
// POINTER: where the pointer is (page coordinates, or A(text)); click: true presses there. A group ends with hide: true
const POINTER = [
  { t: 41.95, page: 'home', at: [1180, 780] },
  { t: 42.55, page: 'home', at: A('I have an agent', 4, 2) },
  { t: 42.68, page: 'home', at: A('I have an agent', 4, 2), click: true },
  { t: 43.0, page: 'home', at: A('I have an agent', 4, 2), hide: true },
  { t: 47.6, page: 'join', at: [1160, 760] },
  { t: 48.75, page: 'join', at: A('Copy', 2, 1) },
  { t: 48.9, page: 'join', at: A('Copy', 2, 1), click: true },
  { t: 49.8, page: 'join', at: A('Copy', 26, 34), hide: true },
  { t: 57.25, page: 'app', at: [980, 720] },
  { t: 57.8, page: 'app', at: A("Your agent's account", 40, 41) },
  { t: 57.9, page: 'app', at: A("Your agent's account", 40, 41), click: true },
  { t: 58.8, page: 'app', at: A("Your agent's account", 60, 44) },
  { t: 59.15, page: 'app', at: A('Follow it', -6, 1) },
  { t: 59.25, page: 'app', at: A('Follow it', -6, 1), click: true },
  { t: 60.2, page: 'appMine', at: [600, 470] },
  { t: 60.75, page: 'appMine', at: A('Tilly', 0, 1) },
  { t: 60.88, page: 'appMine', at: A('Tilly', 0, 1), click: true },
  { t: 61.1, page: 'appMine', at: A('Tilly', 0, 1), hide: true },
];
// ACTIONS: state changes on the pages, each a function of t (scrubbing back undoes them)
const ACTIONS = {
  copied: { page: 'join', at: 48.95 }, // the Copy button says "Copied"
  type: { page: 'app', from: 57.95, to: 58.75, text: AGENT }, // typed into "Your agent's account"
};
// TERMINAL: what the agent's tools printed, from agents/fixtures/mcp-proof.json (real output, shortened)
const TERMINAL = {
  title: 'your agent · canary-court-mcp · NEAR testnet',
  lines: [
    [50.35, 'cmd', 'setup_agent {"name":"cc-mcp-fb0e07","role":"provider"}'],
    [50.9, 'out', 'account cc-mcp-fb0e07.testnet · role provider (attacker)'],
    [51.1, 'out', '~10 testnet NEAR from the faucet · 0.1 NEAR compute for OutLayer fees'],
    [51.3, 'out', 'function-call key added (escrow only, 0-deposit methods)'],
    [52.6, 'cmd', 'list_open_jobs {}'],
    [52.95, 'out', '#110  Tilly, a fictional AI treasury agent · tool_misuse · 5 tUSDC per leak'],
    [53.35, 'cmd', 'place_bid {"job_id":110,"price_usdc":5}'],
    [53.75, 'out', 'ok · bid on job #110 at 5 tUSDC per leak'],
    [54.05, 'cmd', 'get_notifications {}'],
    [54.4, 'hi', 'Your bid on job #110 was accepted: you are its attacker.'],
    [54.85, 'cmd', 'submit_attack {"job_id":110,"category":"tool_misuse","payload":"… 357 chars …"}'],
    [55.6, 'hi', 'sealed for the TEE · finding #110 · fee 0.02 NEAR from your compute balance'],
  ],
  cps: 120, // typing speed of the commands (characters per second)
};
// REPLAY: job #110's own page plays back its history, line by line
const REPLAY = {
  page: 'job',
  events: [61.55, 62.15, 62.75, 63.4, 64.5], // the timeline's five lines appear in turn: posted, bid, hired, sealed, verdict
  steps: [[61.55, 0], [62.75, 1], [63.4, 2], [64.5, 1]], // the current "Where this job is now" step (0 open … 3 finished)
  verdict: 64.5, // Valid: the money bar fills, the finding and the attack rows appear
};
// CAPTIONS: one plain sentence per beat, under the card, in step with the action
const CAPTIONS = [
  [46.8, 50.0, 'Give your agent one sentence.'],
  [50.0, 52.55, 'It joins the market on its own: a free testnet account, no tokens.'],
  [52.55, 54.75, 'It finds a job and bids.'],
  [54.75, 57.0, 'It sends one sealed attack. Nobody can read it, not even the owner.'],
  [57.0, 64.1, 'You watch it all happen, live.'],
  [64.1, 66.5, 'Inside a TEE, the attack runs against the fictional bot. The key leaked.'],
  [66.5, 69.4, 'Paid in the same step. The owner gets the sealed report.'],
];
const CARD = 0.96; // the card's scale at z = 1 (1440×900 → 1382×864, above the caption band)
const BAND = 150; // the caption band under the card (product section)
// the camera never looks past the card's edge: once zoomed in, the focus is held inside the page
function inside(c) {
  const hw = W / (2 * CARD * c.z), hh = (H - BAND) / (2 * CARD * c.z);
  const vx = hw >= 720 ? 720 : clamp(c.f[0], hw, 1440 - hw);
  const vy = hh >= 450 ? 450 : clamp(c.f[1] - c.scroll, hh, 900 - hh);
  c.f = [vx, vy + c.scroll];
  return c;
}

// ════════════════════════════════════════════════════════════════════════ engine
const W = 1920, H = 1080;
const qs = new URLSearchParams(location.search);
const CAPTURE = qs.has('capture');
const $ = (s, el = document) => el.querySelector(s);
const el = (tag, cls, parent) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
};
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;
const easeOut = (u) => 1 - Math.pow(1 - clamp(u), 3);
const easeInOut = (u) => ((u = clamp(u)) < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const ramp = (t, a, b) => clamp((t - a) / (b - a));
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const stage = $('#stage');
const layers = [];

// ─────────────────────────────── text: one sentence, words rise in one by one
function words(text) {
  return text.split(/\s+/).map((w) => {
    const u = /^_(.+)_([.,!?]?)$/.exec(w);
    return u ? { w: u[1] + u[2], u: true } : { w, u: false };
  });
}
function buildWords(box, text) {
  const spans = [];
  words(text).forEach((x, i) => {
    if (i) box.appendChild(document.createTextNode(' '));
    const s = el('span', 'w' + (x.u ? ' u' : ''), box);
    s.textContent = x.w;
    spans.push(s);
  });
  return spans;
}
function revealWords(spans, lt, start, stagger, dur, rise, blur) {
  spans.forEach((s, i) => {
    const e = easeOut((lt - start - i * stagger) / dur);
    s.style.opacity = e;
    s.style.transform = `translateY(${(1 - e) * rise}px)`;
    s.style.filter = blur && e < 1 ? `blur(${(1 - e) * blur}px)` : 'none';
  });
}
function textScene(cue) {
  const root = el('div', 'layer center ground-paper', stage);
  const box = el('div', 'sentence', root);
  const spans = buildWords(box, cue.text);
  const sub = cue.sub ? el('div', 'sub', root) : null;
  if (sub) sub.textContent = cue.sub;
  return {
    root,
    render(t) {
      const lt = t - cue.at;
      revealWords(spans, lt, cue.in ?? 0.25, 0.085, 0.6, 16, 7);
      if (sub) sub.style.opacity = easeOut((lt - (cue.in ?? 0.25) - spans.length * 0.085 - 0.3) / 0.6);
      root.style.opacity = cue.out === 0 ? 1 : clamp((cue.end - t) / (cue.out ?? 0.38));
    },
  };
}

// ─────────────────────────────── clips: black and white, a slow push, centred word captions
const placeholderCache = new Map();
function placeholderFrame(i, label) {
  const key = `${i}|${label}`;
  if (placeholderCache.has(key)) return placeholderCache.get(key);
  const c = document.createElement('canvas');
  c.width = 960;
  c.height = 540;
  const g = c.getContext('2d');
  const r = rng(1000 + i * 77);
  const base = 70 + r() * 60;
  const grad = g.createLinearGradient(0, 0, 960, 540);
  grad.addColorStop(0, `rgb(${base + 40},${base + 40},${base + 40})`);
  grad.addColorStop(1, `rgb(${base - 30},${base - 30},${base - 30})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 960, 540);
  g.filter = 'blur(10px)';
  for (let k = 0; k < 9; k++) {
    const v = 40 + r() * 170;
    g.fillStyle = `rgba(${v},${v},${v},0.55)`;
    g.fillRect(r() * 960, r() * 300 - 60, 60 + r() * 220, 160 + r() * 380);
  }
  g.filter = 'blur(1.5px)';
  const cx = 300 + r() * 360, sh = 18 + r() * 14;
  g.fillStyle = `rgb(${sh},${sh},${sh})`;
  g.beginPath();
  g.ellipse(cx, 238, 62, 78, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(cx - 210, 560);
  g.bezierCurveTo(cx - 190, 360, cx - 90, 330, cx, 328);
  g.bezierCurveTo(cx + 90, 330, cx + 190, 360, cx + 210, 560);
  g.fill();
  g.filter = 'none';
  g.fillStyle = 'rgba(245,245,245,0.94)';
  g.fillRect(56, 432, 470, 46);
  g.fillStyle = '#111';
  g.font = '700 21px "Apfel Grotezk", sans-serif';
  g.fillText('PLACEHOLDER · ' + label.toUpperCase(), 72, 463);
  g.fillStyle = 'rgba(20,20,20,0.86)';
  g.fillRect(56, 478, 470, 24);
  g.fillStyle = '#ddd';
  g.font = '500 13px "Apfel Grotezk", sans-serif';
  g.fillText('news footage to be supplied', 72, 495);
  const img = g.getImageData(0, 0, 960, 540);
  for (let p = 0; p < img.data.length; p += 4) {
    const n = (r() - 0.5) * 22;
    img.data[p] += n;
    img.data[p + 1] += n;
    img.data[p + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const url = c.toDataURL('image/jpeg', 0.86);
  placeholderCache.set(key, url);
  return url;
}
function clipMedia(clip, i, cls, sound = false) {
  if (clip.src && /\.(mp4|webm|mov)$/i.test(clip.src)) {
    const v = document.createElement('video');
    v.src = clip.src;
    v.muted = !sound;
    if (sound) videosWithSound.add(v);
    v.playsInline = true;
    v.preload = 'auto';
    v.className = cls;
    return v;
  }
  const img = document.createElement('img');
  img.className = cls;
  img.src = clip.src || placeholderFrame(i, clip.source);
  return img;
}
const videosWithSound = new Set();
const pendingSeeks = [];
function syncVideo(v, lt, playing) {
  if (!(v instanceof HTMLVideoElement)) return;
  const d = v.duration;
  if (Number.isFinite(d) && d > 0) lt = v.loop ? lt % d : Math.min(lt, d - 0.01);
  lt = Math.max(0, lt);
  if (!playing || CAPTURE) {
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - lt) > 0.02) {
      v.currentTime = lt;
      if (CAPTURE) pendingSeeks.push(new Promise((r) => v.addEventListener('seeked', r, { once: true })));
    }
  } else {
    if (v.paused) v.play().catch(() => {});
    if (Math.abs(v.currentTime - lt) > 0.25) v.currentTime = lt;
  }
}
function quiet(v) {
  if (v instanceof HTMLVideoElement && !v.paused) v.pause();
}
function clipScene(cue) {
  const clip = CLIPS[cue.clip];
  const root = el('div', 'layer ground-night', stage);
  const media = clipMedia(clip, cue.clip, 'clip-media', true);
  root.appendChild(media);
  const cap = el('div', 'caption', root);
  if (CONFIG.clipCredits && clip.credit) el('div', 'credit', root).textContent = clip.credit;
  let shown = -1, spans = [];
  return {
    root,
    render(t, playing) {
      const lt = t - cue.at;
      media.style.transform = `scale(${1 + 0.045 * (lt / (cue.end - cue.at))})`;
      syncVideo(media, lt, playing);
      let k = -1;
      clip.words.forEach(([at], j) => {
        if (lt >= at) k = j;
      });
      if (k !== shown) {
        cap.textContent = '';
        spans = k >= 0 ? buildWords(cap, clip.words[k][1]) : [];
        shown = k;
      }
      if (k >= 0) revealWords(spans, lt, clip.words[k][0], 0.06, 0.22, 6, 0);
    },
    hide() {
      quiet(media);
    },
  };
}

// ─────────────────────────────── the wall: clips multiply into a mosaic
function wallScene(cue) {
  const root = el('div', 'layer ground-night', stage);
  const plane = el('div', '', root);
  plane.style.cssText = 'position:absolute;inset:0;transform-origin:50% 50%';
  const r = rng(4242);
  const media = WALL.length ? WALL : CLIPS;
  const real = WALL.length > 0;
  const cols = real ? 4 : 6, rows = real ? 4 : 6, cw = W / cols, ch = H / rows;
  const tiles = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const w = real ? 520 + r() * 170 : 330 + r() * 230;
      tiles.push({ x: i * cw + cw / 2 + (r() - 0.5) * 120 - w / 2, y: j * ch + ch / 2 + (r() - 0.5) * 90 - (w * 9) / 32, w, order: r() });
    }
  // the first tile lands near the top left (as the first clip in the reference), then they multiply
  tiles.sort((a, b) => a.order - b.order);
  tiles.unshift({ x: 120, y: 90, w: real ? 640 : 520, order: 0 });
  const n = Math.min(cue.tiles ?? 34, tiles.length);
  const D = cue.end - cue.at;
  const nodes = tiles.slice(0, n).map((p, k) => {
    const d = el('div', 'tile', plane);
    d.style.cssText += `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${(p.w * 9) / 16}px`;
    const clip = media[k % media.length];
    const m = clipMedia(clip.src ? clip : { ...clip, source: `news clip ${(k % 9) + 1}` }, 100 + (k % 9), '');
    if (m instanceof HTMLVideoElement) m.loop = true;
    d.appendChild(m);
    return { d, m, at: 0.25 + (D - 1.3) * Math.pow(k / n, 1.7), off: (k * 0.37) % 1.5 };
  });
  return {
    root,
    render(t, playing) {
      const lt = t - cue.at;
      plane.style.transform = `scale(${1.06 - 0.06 * easeInOut(lt / D)})`;
      for (const x of nodes) {
        const e = easeOut((lt - x.at) / 0.22);
        x.d.style.opacity = e;
        x.d.style.transform = `scale(${1.05 - 0.05 * e})`;
        syncVideo(x.m, x.off + Math.max(0, lt - x.at), playing && e > 0);
      }
    },
    hide() {
      for (const x of nodes) quiet(x.m);
    },
  };
}

// ─────────────────────────────── the product: the real site in a floating card, one camera, a pointer
const pageFrames = {};
let card = null;
const docs = {}; // page → same-origin document (or null when cross-origin)
const VH = 900; // the site's viewport height in the card: one "screen" of the story

function resolveAnchor(page, a) {
  if (typeof a === 'number') return a;
  const doc = docs[page];
  if (!a.cache && doc) {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const i = n.textContent.indexOf(a.text);
      if (i < 0) continue;
      const range = doc.createRange();
      range.setStart(n, i);
      range.setEnd(n, i + a.text.length);
      const r = range.getBoundingClientRect();
      if (!r.width) continue;
      const sy = doc.defaultView.scrollY;
      a.cache = { x: r.left + r.width / 2, y: r.top + sy + r.height / 2, top: r.top + sy };
      break;
    }
  }
  return a.cache ?? null;
}
// the row around a line of text: its nearest ancestor at least minW px wide (default 560) and minH tall, padded
const rows = {};
function rowRect(page, spec) {
  const text = typeof spec === 'string' ? spec : spec.text;
  const minW = typeof spec === 'string' ? 560 : (spec.minW ?? 560);
  const minH = typeof spec === 'string' ? 0 : (spec.minH ?? 0);
  const key = `${page}|${text}|${minW}|${minH}`;
  if (key in rows) return rows[key];
  const doc = docs[page];
  let out = null;
  if (doc) {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!n.textContent.includes(text)) continue;
      let e = n.parentElement;
      while (e && e !== doc.body && (e.getBoundingClientRect().width < minW || e.getBoundingClientRect().height < minH)) e = e.parentElement;
      const r = e.getBoundingClientRect();
      if (!r.width) continue;
      const sy = doc.defaultView.scrollY;
      out = { x: r.left - 14, y: r.top + sy - 10, w: r.width + 28, h: r.height + 20 };
      break;
    }
  }
  if (out) rows[key] = out;
  return out;
}
function scrollOf(page, s) {
  if (s === undefined) return 0;
  if (typeof s === 'number') return s;
  const p = resolveAnchor(page, s);
  const doc = docs[page];
  const max = doc ? Math.max(0, doc.documentElement.scrollHeight - VH) : Infinity;
  return p ? clamp(p.top - s.top, 0, max) : s.fb;
}
function focusOf(page, f = WHOLE) {
  if (Array.isArray(f)) return [f[0], typeof f[1] === 'number' ? f[1] : scrollOf(page, f[1]) + VH / 2];
  const p = resolveAnchor(page, f);
  return p ? [p.x + f.dx, p.y + f.dy] : f.fb;
}
// a shot's scroll and focus in document px (on home the story position sets the scroll, and f is in viewport px)
function shotView(s) {
  if (s.page === 'term') return { f: WHOLE, scroll: 0 };
  const scroll = s.story !== undefined ? s.story * VH : scrollOf(s.page, s.scroll);
  const f = focusOf(s.page, s.f);
  return { scroll, f: s.story !== undefined ? [f[0], f[1] + scroll] : f };
}
function firstShotOf(k) {
  let j = k;
  while (j > 0 && SHOTS[j - 1].page === SHOTS[k].page) j--;
  return j;
}
function camera(t) {
  let k = 0;
  while (k + 1 < SHOTS.length && SHOTS[k + 1].t <= t) k++;
  const a = SHOTS[k], b = SHOTS[k + 1];
  const j = firstShotOf(k);
  const prev = j > 0 ? SHOTS[j - 1] : null;
  const from = prev ? inside({ page: prev.page, ...shotView(prev), z: prev.z ?? 1, spot: prev.spot, story: prev.story, pull: prev.pull ?? 0 }) : null;
  const base = { page: a.page, since: t - SHOTS[j].t, from, cut: SHOTS[j].cut ?? 0.4 };
  const va = shotView(a);
  if (!b || b.page !== a.page)
    return inside({ ...base, ...va, z: a.z ?? 1, story: a.story, pull: a.pull ?? 0, night: a.night ?? 0, spot: a.spot, lit: a.spot ? 1 : 0 });
  const u = easeInOut((t - a.t) / (b.t - a.t));
  const vb = shotView(b);
  const mix = (x = 0, y = 0) => lerp(x, y, u);
  return inside({
    ...base,
    f: [lerp(va.f[0], vb.f[0], u), lerp(va.f[1], vb.f[1], u)],
    scroll: lerp(va.scroll, vb.scroll, u),
    z: Math.exp(lerp(Math.log(a.z ?? 1), Math.log(b.z ?? 1), u)),
    story: a.story !== undefined ? mix(a.story, b.story) : undefined,
    pull: mix(a.pull, b.pull),
    night: mix(a.night, b.night),
    spot: a.spot ?? b.spot,
    lit: lerp(a.spot ? 1 : 0, b.spot ? 1 : 0, u),
  });
}
function cardTransform(f, scroll, z) {
  const s = CARD * z;
  return { s, tx: W / 2 - f[0] * s, ty: (H - BAND) / 2 - (f[1] - scroll) * s };
}

// the pointer: groups of keyframes (a group ends with hide: true), eased between them, pressed on click
const POINTER_GROUPS = (() => {
  const out = [];
  let g = [];
  for (const p of POINTER) {
    g.push(p);
    if (p.hide) {
      out.push(g);
      g = [];
    }
  }
  if (g.length) out.push(g);
  return out;
})();
const pointOf = (p) => (Array.isArray(p.at) ? p.at : (() => {
  const r = resolveAnchor(p.page, p.at);
  return r ? [r.x + p.at.dx, r.y + p.at.dy] : p.at.fb;
})());
function pointerAt(t) {
  for (const g of POINTER_GROUPS) {
    const t0 = g[0].t, t1 = g[g.length - 1].t;
    if (t < t0 - 0.25 || t > t1 + 0.25) continue;
    let k = 0;
    while (k + 1 < g.length && g[k + 1].t <= t) k++;
    const a = g[k], b = g[k + 1];
    const pa = pointOf(a), pb = b ? pointOf(b) : pa;
    const u = b ? easeInOut((t - a.t) / (b.t - a.t)) : 0;
    const press = g.filter((p) => p.click).map((p) => t - p.t).filter((d) => d >= 0 && d < 0.5)[0];
    return { x: lerp(pa[0], pb[0], u), y: lerp(pa[1], pb[1], u), vis: Math.min(ramp(t, t0 - 0.25, t0), 1 - ramp(t, t1, t1 + 0.25)), press };
  }
  return null;
}

// actions on the pages: each state is a function of t
function applyActions(t) {
  const jd = docs[ACTIONS.copied.page];
  const span = jd?.querySelector('button span[aria-live]');
  if (span) {
    const want = t >= ACTIONS.copied.at ? 'Copied' : 'Copy';
    if (span.textContent !== want) span.textContent = want;
  }
  const ty = ACTIONS.type, ad = docs[ty.page];
  const input = ad?.querySelector('input[placeholder^="e.g."]');
  if (input) {
    const v = ty.text.slice(0, Math.floor(clamp((t - ty.from) / (ty.to - ty.from)) * ty.text.length));
    if (input.value !== v) {
      const win = ad.defaultView;
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set.call(input, v); // as typing does (React sees it)
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
    }
  }
}
// job #110 replays its history: timeline lines in turn, the current step, the verdict's payout
let rep = null;
function replayRefs() {
  const doc = docs[REPLAY.page];
  if (!doc) return null;
  if (rep) return rep;
  const find = (text, sel) => [...doc.querySelectorAll(sel)].find((e) => e.textContent.includes(text));
  const events = find('client posted job', 'ol'), steps = find('Open, waiting for bids', 'ol');
  const caption = find('From left:', 'p');
  const bar = caption?.previousElementSibling, sum = bar?.previousElementSibling;
  if (!events || !steps || !bar) return null;
  const nums = sum ? [...sum.querySelectorAll('.tabular')] : [];
  rep = {
    lis: [...events.children],
    steps: [...steps.children].map((li) => li.querySelector('span')),
    segs: [...bar.children],
    widths: [...bar.children].map((x) => parseFloat(x.style.width) || 0),
    nums,
    numText: nums.map((n) => n.textContent),
    finding: find('in one callback', 'ul'),
    attack: find('Report sealed for the owner', 'ul'),
  };
  return rep;
}
function applyReplay(t) {
  const r = replayRefs();
  if (!r) return;
  r.lis.forEach((li, i) => {
    const e = easeOut((t - (REPLAY.events[i] ?? REPLAY.events.at(-1))) / 0.4);
    li.style.opacity = e;
    li.style.transform = e < 1 ? `translateY(${(1 - e) * 10}px)` : '';
  });
  let cur = -1;
  for (const [at, i] of REPLAY.steps) if (t >= at) cur = i;
  r.steps.forEach((sp, i) => {
    if (!sp) return;
    sp.style.color = i === cur ? 'var(--fg)' : i < cur ? 'var(--fg-2)' : 'var(--fg-3)';
    sp.style.fontWeight = i === cur ? '500' : '400';
  });
  const v = easeInOut((t - REPLAY.verdict - 0.1) / 0.7);
  const [paid, , escrow] = r.widths;
  if (r.segs[0]) r.segs[0].style.width = `${paid * v}%`;
  if (r.segs[2]) r.segs[2].style.width = `${escrow + paid * (1 - v)}%`;
  if (r.nums.length >= 4) {
    const after = t >= REPLAY.verdict + 0.35;
    const want = [r.numText[1], r.numText[3]];
    const before = ['0', String(Number(r.numText[3]) + Number(r.numText[1]))];
    [1, 3].forEach((n, i) => {
      const s = after ? want[i] : before[i];
      if (r.nums[n].textContent !== s) r.nums[n].textContent = s;
    });
  }
  if (r.finding) r.finding.style.opacity = easeOut((t - REPLAY.verdict - 0.3) / 0.4);
  if (r.attack) r.attack.style.opacity = easeOut((t - REPLAY.verdict - 0.5) / 0.4);
}
// home: the site's words pull back (an injected rule outranks the story's own inline opacities)
function applyHome(view) {
  const doc = docs.home;
  if (!doc) return;
  const p = view.pull ?? 0;
  doc.documentElement.classList.toggle('ccf-pull', p > 0);
  doc.documentElement.style.setProperty('--ccf-o', String(1 - p));
}

function productScene(cue) {
  const root = el('div', 'layer ground-paper', stage);
  root.style.zIndex = 4;
  root.dataset.keepAlive = '1'; // always laid out, so its pages load and can be measured while hidden
  const view = el('div', 'cardview', root); // the card's frame: everything above the caption band
  view.style.height = `${H - BAND}px`;
  card = el('div', 'card', view);
  el('div', 'viewfade', view);
  const spot = el('div', 'spot', card);
  for (const name of Object.keys(PAGES)) {
    const f = el('iframe', '', card);
    f.setAttribute('tabindex', '-1');
    f.setAttribute('aria-hidden', 'true');
    f.dataset.page = name;
    pageFrames[name] = f;
  }
  const night = el('div', 'night', root);
  const term = el('div', 'term', root);
  el('div', 'term-bar', term).textContent = TERMINAL.title;
  const body = el('div', 'term-body', term);
  const lines = TERMINAL.lines.map(([at, kind, text]) => {
    const d = el('div', `tl ${kind}`, body);
    return { at, kind, text, d };
  });
  const cap = el('div', 'flowcap', root);
  cap.style.top = `${H - BAND}px`;
  cap.style.height = `${BAND}px`;
  const ptr = el('div', 'pointer', root);
  ptr.innerHTML = '<span class="ring"></span><svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M2 1.5 L2 19.5 L7 14.8 L10.4 22.4 L13.6 21 L10.3 13.6 L17 13.6 Z" fill="#17171a" stroke="#f6f5f1" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const ring = ptr.querySelector('.ring');
  return {
    root,
    render(t) {
      const cam = camera(t);
      const onTerm = cam.page === 'term';
      const vw = onTerm ? cam.from : cam; // while the terminal is up, the card keeps the page it left
      const shown = vw.page;
      const { s, tx, ty } = cardTransform(vw.f, vw.scroll, vw.z ?? 1);
      card.style.transform = `translate(${tx}px,${ty}px) scale(${s})`;
      const fade = cue.fadeIn ? ramp(t, ...cue.fadeIn) : 1;
      const out = cue.fadeOut ? 1 - ramp(t, ...cue.fadeOut) : 1;
      const termOn = onTerm ? ramp(cam.since, 0, 0.3) : cam.from?.page === 'term' ? 1 - ramp(cam.since, 0, 0.3) : 0;
      card.style.opacity = Math.min(fade, out) * (onTerm ? 1 - termOn : 1);
      const fromPage = !onTerm && cam.from && cam.from.page !== 'term' && cam.since < cam.cut ? cam.from.page : null;
      for (const [name, f] of Object.entries(pageFrames)) {
        const o = name === shown ? 1 : name === fromPage ? 1 - ramp(cam.since, 0, cam.cut) : 0;
        f.style.opacity = o;
        f.style.zIndex = name === shown ? 1 : 2; // the outgoing page fades out on top of the incoming one
        f.style.visibility = o > 0 ? 'visible' : 'hidden';
      }
      const setScroll = (page, y) => {
        const d = docs[page];
        if (d && Math.round(d.defaultView.scrollY) !== Math.round(y)) d.defaultView.scrollTo(0, Math.round(y));
      };
      setScroll(shown, vw.scroll);
      if (fromPage) setScroll(fromPage, cam.from.scroll); // the outgoing page as it was left
      const lit = onTerm ? (vw.spot ? 1 : 0) : cam.lit;
      const r = lit > 0 && vw.spot ? rowRect(shown, vw.spot) : null;
      spot.style.opacity = r ? lit : 0;
      if (r) Object.assign(spot.style, { left: `${r.x}px`, top: `${r.y - vw.scroll}px`, width: `${r.w}px`, height: `${r.h}px` });
      night.style.opacity = onTerm ? 0 : (cam.night ?? 0);
      if (shown === 'home') applyHome(vw);
      if (shown === 'join' && docs.join) patchHost(docs.join, CAPTURE);
      applyActions(t);
      applyReplay(t);
      // the terminal: commands type in, their output appears
      term.style.display = termOn > 0 ? 'block' : 'none';
      term.style.opacity = termOn * out;
      lines.forEach((L, i) => {
        const on = t >= L.at;
        L.d.style.display = on ? 'block' : 'none';
        if (!on) return;
        if (L.kind === 'cmd') {
          const n = Math.min(L.text.length, Math.floor((t - L.at) * TERMINAL.cps));
          const next = lines[i + 1];
          const caret = n < L.text.length || !next || t < next.at;
          L.d.textContent = L.text.slice(0, n);
          L.d.classList.toggle('caret', caret);
        } else {
          if (!L.d.textContent) L.d.textContent = L.text;
          L.d.style.opacity = easeOut((t - L.at) / 0.18);
        }
      });
      // the caption for this beat
      const c = CAPTIONS.find(([a, b]) => t >= a && t < b);
      if (c && cap.textContent !== c[2]) cap.textContent = c[2];
      cap.style.opacity = c ? Math.min(easeOut((t - c[0]) / 0.3), 1 - ramp(t, c[1] - 0.22, c[1])) * out : 0;
      cap.style.transform = c ? `translateY(${(1 - easeOut((t - c[0]) / 0.3)) * 8}px)` : '';
      // the pointer, on the page under the camera
      const p = onTerm ? null : pointerAt(t);
      ptr.style.display = p && p.vis > 0 ? 'block' : 'none';
      if (p && p.vis > 0) {
        const press = p.press === undefined ? 1 : p.press < 0.12 ? 0.84 : 0.84 + 0.16 * easeOut((p.press - 0.12) / 0.2);
        ptr.style.opacity = p.vis * out;
        ptr.style.transform = `translate(${tx + p.x * s}px,${ty + (p.y - vw.scroll) * s}px)`;
        ptr.querySelector('svg').style.transform = `scale(${press})`;
        const e = p.press === undefined ? 1 : easeOut(p.press / 0.45);
        ring.style.opacity = p.press === undefined ? 0 : 0.45 * (1 - e);
        ring.style.transform = `translate(-50%,-50%) scale(${0.3 + 0.7 * e})`;
      }
    },
  };
}
// /join names the address the site was reached on; in the film it names the public one
let lastPatch = 0;
function patchHost(doc, force) {
  if (!CONFIG.host || (!force && performance.now() - lastPatch < 250)) return;
  lastPatch = performance.now();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) if (/https?:\/\/localhost:\d+/.test(n.textContent)) n.textContent = n.textContent.replace(/https?:\/\/localhost:\d+/g, CONFIG.host);
}
function headerMarkRect() {
  // the slot the lone mark falls into: the mark in the site header's wordmark (its first 97.17 of 1032.54 units)
  const doc = docs.home;
  let r = { x: 60, y: 21, w: 19.06, h: 22 };
  const svg = doc?.querySelector('header svg[viewBox^="0 0 1032"]') ?? doc?.querySelector('header svg');
  if (svg) {
    const b = svg.getBoundingClientRect();
    if (b.width) r = { x: b.left, y: b.top, w: (b.width * 97.17) / 1032.54, h: b.height };
  }
  const v = shotView(SHOTS[0]);
  const { s, tx, ty } = cardTransform(v.f, v.scroll, SHOTS[0].z ?? 1);
  return { x: tx + r.x * s, y: ty + r.y * s, w: r.w * s, h: r.h * s };
}

// ─────────────────────────────── the mark
const MARK_PATHS = `<path d="M26.26,62.3 34.61,57.48 26.26,52.66Z" fill="#D2AE3C"/><path d="M51.41,76.82 59.76,72 51.41,67.18Z M50,77.63 51.41,76.82 51.41,67.18 49.49,66.07 39.73,71.7Z M59.76,72 60.46,71.59 51.41,66.37 51.41,67.18Z M51.41,66.37 50.19,65.66 49.49,66.07 51.41,67.18Z M39.73,71.7 49.49,66.07 36.02,58.29 26.26,63.93 26.26,63.93Z M49.49,66.07 50.19,65.66 50,65.55 49.3,65.96Z M72.52,64.63 62.77,59 51.41,65.55 51.41,66.37 60.46,71.59Z M51.41,65.55 50.7,65.96 51.41,66.37Z M86.7,56.45 76.94,50.81 62.77,59 72.52,64.63Z" fill="#AAAAA8"/><path d="M62.06,41.41 86.7,27.19 51.41,6.81 51.41,35.26Z M51.41,6.81 51.41,6.81 51.41,35.26 51.41,35.26Z M51.41,6.81 50,6 26.26,19.71 26.26,20.74 51.41,35.26Z M26.26,19.71 25.36,20.22 26.26,20.74Z M51.41,47.56 62.06,41.41 51.41,35.26Z M50,48.37 51.41,47.56 51.41,35.26 26.26,20.74 26.26,34.67Z M26.26,34.67 26.26,20.74 25.36,20.22 13.3,27.19 25.55,34.26Z M13.3,27.19 13.3,27.19 23.44,33.04 23.44,33.04Z" fill="#AAAAA8"/><path d="M76.23,49.59 88.11,42.74 88.11,28 63.47,42.22Z M51.41,63.93 76.23,49.59 63.47,42.22 51.41,49.19Z" fill="#707070"/><path d="M51.41,93.19 73.93,80.18 61.17,72.81 51.41,78.45Z M73.93,80.18 88.11,72 88.11,57.26 61.17,72.81Z" fill="#707070"/><path d="M11.89,72 24.85,79.48 24.85,35.48 11.89,28Z M24.85,50.22 50,64.74 50,50 24.85,35.48Z M24.85,79.48 50,94 50,79.26 24.85,64.74Z" fill="#17171A"/>`;
function markScene(cue) {
  const root = el('div', 'layer', stage);
  root.style.zIndex = 5;
  const m = el('div', 'mark', root);
  m.innerHTML = `<svg viewBox="11.89 6 76.22 88" width="100%" height="100%" aria-hidden="true">${MARK_PATHS}</svg>`;
  const bg = el('div', '', root);
  bg.style.cssText = 'position:absolute;inset:0;background:var(--paper);z-index:-1';
  const H0 = 290, W0 = (H0 * 76.22) / 88;
  return {
    root,
    render(t) {
      const lt = t - cue.at;
      const appear = easeOut(lt / 0.7);
      const u = easeInOut((t - cue.fly) / (cue.land - cue.fly));
      const to = headerMarkRect();
      const w = Math.exp(lerp(Math.log(W0), Math.log(to.w), u)), h = (w * 88) / 76.22;
      const cx = lerp(W / 2, to.x + to.w / 2, u), cy = lerp(H / 2, to.y + to.h / 2, u);
      m.style.width = `${w}px`;
      m.style.height = `${h}px`;
      m.style.transform = `translate(${cx - w / 2}px,${cy - h / 2 + (1 - appear) * 10}px)`;
      m.style.opacity = appear * (1 - ramp(t, cue.land - 0.05, cue.land + 0.25));
      bg.style.opacity = 1 - ramp(t, cue.fly + 0.5, cue.land); // the paper gives way to the card underneath
    },
  };
}

// ─────────────────────────────── proof: three numbers, from the site's facts
function proofScene(cue) {
  const root = el('div', 'layer center ground-paper', stage);
  const grid = el('div', 'figures', root);
  const items = cue.items.map(([v, l]) => {
    const f = el('div', 'figure', grid);
    el('div', 'v', f).textContent = v;
    el('div', 'l', f).textContent = l;
    return f;
  });
  return {
    root,
    render(t) {
      const lt = t - cue.at;
      items.forEach((f, i) => {
        const e = easeOut((lt - 0.35 - i * 0.55) / 0.7);
        f.style.opacity = e;
        f.style.transform = `translateY(${(1 - e) * 18}px)`;
      });
      root.style.opacity = clamp((cue.end - t) / 0.45);
    },
  };
}

// ─────────────────────────────── the close: lockup, tagline, address
function lockupScene(cue) {
  const root = el('div', 'layer center ground-paper', stage);
  const box = el('div', 'center', root);
  const img = el('img', 'lockup-img', box);
  img.src = 'assets/brand/lockup-paper.svg';
  img.alt = 'Canary Court';
  const tag = el('div', 'tagline', box);
  tag.textContent = cue.tagline;
  const url = el('div', 'url', box);
  url.textContent = CONFIG.host.replace(/^https?:\/\//, '');
  return {
    root,
    render(t) {
      const lt = t - cue.at;
      img.style.opacity = easeOut((lt - 0.15) / 0.8);
      const e = easeOut((t - cue.tagAt) / 0.8);
      tag.style.opacity = e;
      tag.style.transform = `translateY(${(1 - e) * 14}px)`;
      url.style.opacity = easeOut((t - cue.tagAt - 0.55) / 0.8);
      // the lockup sits centred alone, then makes room for the tagline
      box.style.transform = `translateY(${(1 - easeInOut((t - cue.tagAt + 0.1) / 0.9)) * 64}px)`;
    },
  };
}

const SCENES = { text: textScene, clip: clipScene, wall: wallScene, mark: markScene, product: productScene, proof: proofScene, lockup: lockupScene };
for (const cue of CUES) layers.push({ cue, ...SCENES[cue.scene](cue) });

// ════════════════════════════════════════════════════════════════════════ clock, audio, controls
let t = clamp(Number(qs.get('t') ?? 0), 0, DURATION);
let playing = false, lastNow = 0;
const audio = new Audio();
let audioOk = false;
audio.preload = 'auto';
audio.addEventListener('canplaythrough', () => (audioOk = true));
audio.addEventListener('error', () => (audioOk = false));
if (!CAPTURE) audio.src = CONFIG.audio;

function render(x) {
  for (const L of layers) {
    const on = x >= L.cue.at && (x < L.cue.end || (L.cue.end === DURATION && x <= DURATION));
    if (L.root.dataset.keepAlive) {
      L.root.style.display = 'block';
      L.root.style.opacity = on ? 1 : 0; // not visibility: the iframes' own visibility would override a hidden parent
    } else L.root.style.display = on ? (L.root.classList.contains('center') ? 'flex' : 'block') : 'none';
    if (on) L.render(x, playing);
    else L.hide?.();
  }
  // the score dips under a clip's speech
  let speech = 0;
  for (const c of CUES) if (c.scene === 'clip') speech = Math.max(speech, ramp(x, c.at - 0.12, c.at) * (1 - ramp(x, c.end, c.end + 0.15)));
  if (!CAPTURE) audio.volume = 1 - (1 - CONFIG.duck) * speech;
  if (!CAPTURE) updateBar(x);
}
function play() {
  if (t >= DURATION) t = 0;
  playing = true;
  lastNow = performance.now();
  if (audioOk) {
    audio.currentTime = t;
    audio.play().catch(() => {});
  }
  $('#play').textContent = 'Pause';
}
function pause() {
  playing = false;
  audio.pause();
  $('#play').textContent = 'Play';
}
function seek(x) {
  t = clamp(x, 0, DURATION);
  if (audioOk) audio.currentTime = t;
  lastNow = performance.now();
  render(t);
}
function frame(now) {
  if (playing) {
    if (audioOk && !audio.paused && !audio.seeking) t = audio.currentTime;
    else t += (now - lastNow) / 1000;
    lastNow = now;
    if (t >= DURATION) {
      t = DURATION;
      pause();
    }
    render(t);
  }
  requestAnimationFrame(frame);
}

const fmt = (x) => `${Math.floor(x / 60)}:${(x % 60).toFixed(2).padStart(5, '0')}`;
function cueAt(x) {
  let c = CUES[0];
  for (const q of CUES) if (x >= q.at) c = q;
  return c;
}
function updateBar(x) {
  $('#time').textContent = `${fmt(x)} / ${fmt(DURATION).slice(0, -3)}`;
  const s = $('#scrub');
  if (document.activeElement !== s || !scrubbing) s.value = x;
  const c = cueAt(x);
  $('#cuename').textContent = c.id;
  for (const r of document.querySelectorAll('#cues .row')) r.classList.toggle('on', r.dataset.id === c.id);
}
let scrubbing = false;
function setupControls() {
  $('#play').onclick = () => (playing ? pause() : play());
  const s = $('#scrub');
  s.max = DURATION;
  s.addEventListener('input', () => {
    scrubbing = true;
    seek(Number(s.value));
  });
  s.addEventListener('change', () => (scrubbing = false));
  const list = $('#cues');
  for (const c of CUES) {
    const r = el('div', 'row', list);
    r.dataset.id = c.id;
    const what = c.text ?? (c.scene === 'clip' ? `clip: ${CLIPS[c.clip].credit ?? CLIPS[c.clip].source}` : c.scene === 'proof' ? c.items.map((x) => x[0]).join(' · ') : c.scene);
    r.innerHTML = `<span class="t">${fmt(c.at)}–${fmt(c.end)}</span><span class="d">${c.id}<small></small></span>`;
    r.querySelector('small').textContent = what.replace(/_/g, '');
    r.onclick = () => seek(c.at + 0.001);
  }
  $('#cuebtn').onclick = () => list.classList.toggle('open');
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.key !== ' ') return;
    const step = e.shiftKey ? 5 : 1;
    if (e.key === ' ') (playing ? pause() : play());
    else if (e.key === 'ArrowRight') seek(t + step);
    else if (e.key === 'ArrowLeft') seek(t - step);
    else if (e.key === '.') seek(t + 1 / 30);
    else if (e.key === ',') seek(t - 1 / 30);
    else if (e.key === 'Home') seek(0);
    else if (e.key === 'End') seek(DURATION);
    else if (e.key === 'c' || e.key === 'C') list.classList.toggle('open');
    else return;
    e.preventDefault();
  });
}
function fit() {
  const vp = $('#viewport').getBoundingClientRect();
  const k = CAPTURE && innerWidth === W && innerHeight === H ? 1 : Math.min(vp.width / W, vp.height / H);
  stage.style.transform = `translate(${(vp.width - W * k) / 2}px,${(vp.height - H * k) / 2}px) scale(${k})`;
}

// ════════════════════════════════════════════════════════════════════════ boot
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MINE = 'cc-my-agent'; // the market's own key for "Your agent" (site Market.tsx)
const store = (k, v) => {
  try {
    v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
  } catch {}
};
function loadFrame(name) {
  const f = pageFrames[name];
  return new Promise((res) => {
    f.addEventListener(
      'load',
      () => {
        try {
          const doc = f.contentDocument;
          if (doc && doc.body) {
            const st = doc.createElement('style');
            st.textContent =
              'html{scroll-behavior:auto!important;scrollbar-width:none}::-webkit-scrollbar{display:none}' +
              // the pull-back on home: outranks the story's own inline opacities while the film runs the way through
              'html.ccf-pull [data-travel-fade],html.ccf-pull .story-copy,html.ccf-pull .sticky p{opacity:var(--ccf-o)!important}';
            doc.head.appendChild(st);
            docs[name] = doc;
          } else docs[name] = null;
        } catch {
          docs[name] = null; // cross-origin: the camera uses fallback coordinates and can't scroll
        }
        res();
      },
      { once: true },
    );
    f.src = (CONFIG.site || '') + PAGES[name];
  });
}
async function until(test, ms = 15000) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    try {
      if (test()) return true;
    } catch {}
    await sleep(100);
  }
  return false;
}
async function loadPages() {
  store('cc-theme', 'light'); // the site's own theme key: the film is always on paper
  store(MINE, null);
  await Promise.all(['home', 'join', 'job', 'app'].map(loadFrame));
  // the market reads "Your agent" once it has mounted: the plain copy first (an empty form), then the followed one
  await until(() => docs.app.querySelector('input[placeholder^="e.g."]'));
  store(MINE, AGENT);
  await loadFrame('appMine');
  await until(() => [...docs.appMine.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Change'));
  store(MINE, null);
}
const status = (s) => ($('#status').textContent = s);
const ready = (async () => {
  status('loading fonts and the site…');
  await document.fonts.ready;
  await Promise.all(['400 20px "Apfel Grotezk"', '700 20px "Apfel Grotezk"', '400 20px "Erode"'].map((f) => document.fonts.load(f).catch(() => {})));
  await loadPages();
  await new Promise((r) => setTimeout(r, 1500)); // let the pages settle (hydration, images) before measuring
  if (docs.join) patchHost(docs.join, true);
  for (const s of SHOTS) shotView(s);
  for (const p of POINTER) pointOf(p);
  replayRefs();
  const missing = [...SHOTS.flatMap((s) => [s.f, s.scroll]), ...POINTER.map((p) => p.at)].filter((a) => a && a.text && !a.cache).map((a) => a.text);
  if (!rep) missing.push('job replay (timeline, steps or money bar)');
  status(Object.values(docs).every(Boolean) ? (missing.length ? `anchors not found: ${[...new Set(missing)].join(', ')}` : '') : 'site is cross-origin: run node film/serve.mjs for scrolling and anchors');
  render(t);
  window.__filmReady = true;
})();

if (CAPTURE) document.body.classList.add('capture');
else setupControls();
addEventListener('resize', fit);
fit();
render(t);
requestAnimationFrame(frame);

// capture: await window.filmReady; then for each frame await window.filmSeek(t) and screenshot the stage
window.filmReady = ready;
window.filmSeek = async (x) => {
  t = clamp(x, 0, DURATION);
  render(t);
  // the 3D story: wait until the site has drawn the exact frames for this position
  const P = CUES.find((c) => c.scene === 'product');
  const cam = t >= P.at && t < P.end ? camera(t) : null;
  const w = docs.home?.defaultView;
  if (cam?.page === 'home' && cam.story > 0 && w?.__cc?.storyAt)
    await Promise.race([w.__cc.storyAt(cam.story).catch(() => {}), sleep(6000)]);
  if (pendingSeeks.length) await Promise.race([Promise.all(pendingSeeks.splice(0)), sleep(4000)]);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return t;
};
window.film = { CUES, SHOTS, CLIPS, CONFIG, DURATION, seek, play, pause, audio, get t() { return t; } };
