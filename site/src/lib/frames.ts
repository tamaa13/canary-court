// A rendered film, scrubbed by the scroll: never played, a frame is drawn only when the scroll asks for it.
//
// Loading is progressive. `prime()` fetches the anchors (the pinned frames and every 8th, a whole coarse film), then
// `fetchAll()` fills in every 4th, every 2nd and the rest. A reader who asked the browser to save data stops after the
// coarse film; a phone takes the lighter set. Fetching keeps the compressed bytes only. A decoded frame is large
// (1600x1000 RGBA is 6.4 MB), so only frames close to the scroll position are decoded, at the size they're drawn, and
// the farthest are released past a budget. Until the exact frame is decoded, the two nearest decoded neighbours are
// blended.

export type FilmSpec = {
  /** frame count; files are f000…f{n-1} */
  n: number;
  w: number;
  h: number;
  /** folder of the full-size set */
  base: string;
  /** folder and width of the lighter set (same aspect, same names) */
  small: { base: string; w: number };
  /** frames always kept decoded (the ones a still or reduced-motion view rests on) */
  pinned: number[];
  /** cache key: change with every render so a browser never mixes two renders */
  version: string;
  /** most frames held decoded at once (default 22), and how far around the position frames are decoded (default 24) */
  budget?: number;
  reach?: number;
};

export type Pic = ImageBitmap | HTMLImageElement;
export type Pair = { a: Pic; b: Pic | null; mix: number; ia: number; ib: number };

/** how coarse a frame is: 8 for every 8th, then 4, 2, 1 */
const step = (i: number) => (i % 8 === 0 ? 8 : i % 4 === 0 ? 4 : i % 2 === 0 ? 2 : 1);
/** a frame is decoded when its weighted distance to the scroll position is within this (coarse frames reach further,
 *  so a fast scroll still finds a frame; fine ones only near the position) */
const REACH = 24;
/** most frames held decoded at once, pinned ones included */
const BUDGET = 22;
const PARALLEL_FETCH = 4;
const PARALLEL_DECODE = 2;

const saveData = () => !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
/** a phone by the device, not the window: a coarse pointer on a screen whose short side is a phone's */
const isPhone = () => window.matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 600;

export class Film {
  private bytes: (Blob | null)[];
  private pics = new Map<number, Pic>();
  private decoding = new Set<number>();
  private queue: number[] = [];
  private queued = new Set<number>();
  private inflight = new Set<number>();
  private head = 0;
  private flying = 0;
  private stage: 0 | 1 | 2 = 0;
  private small = false;
  private alive = true;
  private want = 0;

  constructor(
    readonly spec: FilmSpec,
    /** called whenever a frame finishes decoding (redraw) */
    private onFrame: () => void,
    /** the width a frame is drawn at, in device pixels (decode no larger) */
    private drawWidth: () => number,
  ) {
    this.bytes = new Array(spec.n).fill(null);
  }

  url(i: number) {
    const dir = this.small ? this.spec.small.base : this.spec.base;
    return `${dir}/f${String(i).padStart(3, "0")}.webp?v=${this.spec.version}`;
  }

  /** the anchors: pinned frames and every 8th */
  prime() {
    if (this.stage >= 1) return;
    this.stage = 1;
    this.small = isPhone();
    const all = Array.from({ length: this.spec.n }, (_, i) => i);
    this.enqueue([...this.spec.pinned, ...all.filter((i) => step(i) === 8)]);
  }

  /** everything else, coarse to fine (only the anchors when saving data) */
  fetchAll() {
    this.prime();
    if (this.stage >= 2) return;
    this.stage = 2;
    if (saveData()) return;
    const all = Array.from({ length: this.spec.n }, (_, i) => i);
    for (const s of [4, 2, 1]) this.enqueue(all.filter((i) => step(i) === s));
  }

  private enqueue(list: number[]) {
    for (const i of list) {
      if (i < 0 || i >= this.spec.n || this.queued.has(i)) continue;
      this.queued.add(i);
      this.queue.push(i);
    }
    while (this.flying < PARALLEL_FETCH && this.head < this.queue.length) this.fetchNext();
  }

  private fetchNext() {
    if (!this.alive) return;
    // (skip frames already fetched or in flight: ensure() may have taken them out of turn)
    while (this.head < this.queue.length && (this.bytes[this.queue[this.head]!] || this.inflight.has(this.queue[this.head]!))) this.head++;
    if (this.head >= this.queue.length) return;
    this.flying++;
    this.get(this.queue[this.head++]!).finally(() => {
      this.flying--;
      this.fetchNext();
    });
  }

  private get(i: number) {
    this.inflight.add(i);
    return fetch(this.url(i))
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!this.alive || !b) return;
        this.bytes[i] = b;
        this.pump();
      })
      .catch(() => {})
      .finally(() => this.inflight.delete(i));
  }

  /** fetch these frames now, ahead of the queue (a capture asking for an exact frame) */
  ensure(list: number[]) {
    if (!this.stage) this.prime();
    for (const i of list) {
      if (i < 0 || i >= this.spec.n || this.bytes[i] || this.inflight.has(i)) continue;
      this.queued.add(i);
      void this.get(i);
    }
  }

  /** whether a frame is decoded and ready to draw */
  has(i: number) {
    return this.pics.has(i);
  }

  /** where the scroll is on the film: decode around it */
  aim(f: number) {
    const x = Math.max(0, Math.min(this.spec.n - 1, f));
    if (Math.abs(x - this.want) < 0.5) return;
    this.want = x;
    this.pump();
  }

  private cost(i: number) {
    return this.spec.pinned.includes(i) ? 0 : (Math.abs(i - this.want) * 8) / step(i);
  }

  private get reach() {
    return this.spec.reach ?? REACH;
  }

  private pump() {
    while (this.alive && this.decoding.size < PARALLEL_DECODE) {
      let best = -1;
      let bestCost = Infinity;
      for (let i = 0; i < this.spec.n; i++) {
        if (!this.bytes[i] || this.pics.has(i) || this.decoding.has(i)) continue;
        const c = this.cost(i);
        if (c <= this.reach && c < bestCost) [best, bestCost] = [i, c];
      }
      if (best < 0) return;
      this.decode(best);
    }
  }

  private decode(i: number) {
    const blob = this.bytes[i]!;
    this.decoding.add(i);
    const fileW = this.small ? this.spec.small.w : this.spec.w;
    const w = Math.max(320, Math.min(fileW, Math.round(this.drawWidth())));
    const h = Math.round((w * this.spec.h) / this.spec.w);
    const done = (p: Pic | null) => {
      this.decoding.delete(i);
      if (!p) return;
      if (!this.alive) return release(p);
      this.pics.set(i, p);
      this.trim();
      this.onFrame();
      this.pump();
    };
    if (typeof createImageBitmap === "function") {
      createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: "high", premultiplyAlpha: "premultiply" })
        .then(done)
        .catch(() => {
          // (some engines refuse the resize options: decode as is)
          createImageBitmap(blob).then(done, () => done(null));
        });
    } else {
      const img = new Image();
      img.src = URL.createObjectURL(blob);
      img.decode().then(
        () => done(img),
        () => done(null),
      );
    }
  }

  /** over budget: release the farthest decoded frames outside the reach */
  private trim() {
    const budget = this.spec.budget ?? BUDGET;
    if (this.pics.size <= budget) return;
    const far = [...this.pics.keys()].filter((i) => this.cost(i) > this.reach).sort((a, b) => this.cost(b) - this.cost(a));
    for (const i of far.slice(0, this.pics.size - budget)) {
      release(this.pics.get(i)!);
      this.pics.delete(i);
    }
  }

  /** the frames to draw for a place on the film: the nearest decoded frame on each side and how far toward the second */
  at(f: number): Pair | null {
    const x = Math.max(0, Math.min(this.spec.n - 1, f));
    this.aim(x);
    let a = Math.floor(x);
    let b = Math.ceil(x);
    while (a >= 0 && !this.pics.has(a)) a--;
    while (b < this.spec.n && !this.pics.has(b)) b++;
    const A = a >= 0 ? this.pics.get(a) : undefined;
    const B = b < this.spec.n ? this.pics.get(b) : undefined;
    if (A && B && a !== b) return { a: A, b: B, mix: (x - a) / (b - a), ia: a, ib: b };
    const one = A ?? B;
    const io = A ? a : b;
    return one ? { a: one, b: null, mix: 0, ia: io, ib: io } : null;
  }

  /** two given frames (a reduced-motion cross-fade between stills), if decoded. At either end of the fade it is the one
   *  frame actually drawn, so `ia`/`ib` always name what's on the canvas */
  pair(ia: number, ib: number, mix: number): Pair | null {
    if (mix >= 0.996) ia = ib;
    else if (mix <= 0.004) ib = ia;
    const A = this.pics.get(ia);
    const B = this.pics.get(ib);
    if (A && B && ia !== ib) return { a: A, b: B, mix, ia, ib };
    const useA = mix < 0.5 ? !!A : !B;
    const one = useA ? A : B;
    const i = useA ? ia : ib;
    return one ? { a: one, b: null, mix: 0, ia: i, ib: i } : null;
  }

  /** let go of every decoded frame (the compressed bytes stay): for a film that has scrolled far away */
  release() {
    this.pics.forEach(release);
    this.pics.clear();
  }

  dispose() {
    this.alive = false;
    this.pics.forEach(release);
    this.pics.clear();
  }
}

function release(p: Pic) {
  if ("close" in p) p.close();
  else if (p.src.startsWith("blob:")) URL.revokeObjectURL(p.src);
}

/** Paint a pair onto a 2D context filling (0,0,w,h). Frames carry alpha; with "lighter" two premultiplied frames at
 *  (1 - mix) and mix add up to their exact blend, so a cross-fade never darkens or doubles the edges. */
export function paint(ctx: CanvasRenderingContext2D, p: Pair, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  if (p.b && p.mix > 0.004 && p.mix < 0.996) {
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1 - p.mix;
    ctx.drawImage(p.a, 0, 0, w, h);
    ctx.globalAlpha = p.mix;
    ctx.drawImage(p.b, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  } else {
    ctx.globalAlpha = 1;
    ctx.drawImage(p.b && p.mix >= 0.996 ? p.b : p.a, 0, 0, w, h);
  }
}
