// The landing's lower sections, each with one object (rt-3d's renders: public/more/p1..p4, 48-frame turntables like
// "How it works", scrubbed by scroll): P1 the receipt spindle (Proof), P2 the defenses (Security), P3 sealed and public
// (Privacy), P4 the vault all the way round (the close: a 72-frame 360° loop that turns on its own). Until a render
// lands (`ready`), a still from the renders we have stands in, so the layout is final either way.

import type { FilmSpec } from "@/lib/frames";

export type MoreKey = "p1" | "p2" | "p3" | "p4";
type Poster = { src: string; w: number; h: number };

export const MORE_3D = { version: "more1", dir: "/more", ready: { p1: true, p2: true, p3: true, p4: true } as Record<MoreKey, boolean> };

/** stand-ins: the closest existing render to each object (the payout, the enclave, the sealed run, the vault at 3/4) */
const STAND_IN: Record<MoreKey, { poster: Poster; bounds: readonly [number, number] }> = {
  p1: { poster: { src: "/how/step5/poster.webp", w: 1200, h: 900 }, bounds: [0.173, 0.834] },
  p2: { poster: { src: "/how/step3/poster.webp", w: 1200, h: 900 }, bounds: [0.15, 0.87] },
  p3: { poster: { src: "/how/step4/poster.webp", w: 1200, h: 900 }, bounds: [0.15, 0.868] },
  p4: { poster: { src: "/story/vault/f212.webp", w: 1600, h: 1000 }, bounds: [0.06, 0.94] },
};

/** rt-3d's renders (site-3d 47ac94f): frames, where the object sits in the frame over the whole turn (top and bottom,
 *  alpha > 40, measured), and for P4, the 360° turntable, its speed: it turns on its own, ~9 s a turn */
const PIECE: Record<MoreKey, { n: number; bounds: readonly [number, number]; loop?: number }> = {
  p1: { n: 48, bounds: [0.151, 0.859] },
  p2: { n: 48, bounds: [0.15, 0.859] },
  p3: { n: 48, bounds: [0.15, 0.855] },
  p4: { n: 72, bounds: [0.15, 0.93], loop: 8 },
};

export function moreObject(k: MoreKey): { film: FilmSpec | null; poster: Poster; bounds: readonly [number, number]; loop?: number } {
  if (!MORE_3D.ready[k]) return { film: null, ...STAND_IN[k] };
  const piece = PIECE[k];
  return {
    film: {
      n: piece.n,
      w: 1200,
      h: 900,
      base: `${MORE_3D.dir}/${k}`,
      small: { base: `${MORE_3D.dir}/${k}-s`, w: 900 },
      pinned: [0],
      version: MORE_3D.version,
      // (a loop needs more of its frames decoded at once than a scrub)
      budget: piece.loop ? 28 : 10,
      reach: piece.loop ? 24 : 16,
    },
    poster: { src: `${MORE_3D.dir}/${k}/poster.webp`, w: 1200, h: 900 },
    bounds: piece.bounds,
    loop: piece.loop,
  };
}
