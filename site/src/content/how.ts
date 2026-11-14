// "How it works": one rendered object per step (rt-3d's 48-frame turntables, site-3d @3adb099), scrubbed as the step
// crosses the screen.

import type { FilmSpec } from "@/lib/frames";

/** site/public/how/step{1..5}{,-s}/f000–f047.webp + poster.webp (= f000); `version` busts the cache when they change */
export const HOW_3D = { version: "how1", dir: "/how" };

export const stepFilm = (n: number): FilmSpec => ({
  n: 48,
  w: 1200,
  h: 900,
  base: `${HOW_3D.dir}/step${n}`,
  small: { base: `${HOW_3D.dir}/step${n}-s`, w: 900 },
  pinned: [0],
  version: HOW_3D.version,
  // (five films on one page: a small decode budget each, released when far away)
  budget: 10,
  reach: 16,
});

export const stepPoster = (n: number) => ({ src: `${HOW_3D.dir}/step${n}/poster.webp`, w: 1200, h: 900 });

/** where each object sits in its frame (top and bottom, as fractions of the frame's height; alpha > 40). The top is the
 *  highest point over the whole turn; the bottom is the lowest point over frames 18–28, the poses on screen while the
 *  step is read (the turn dips a little lower at its two ends, and only the faint ground shadow reaches the caption
 *  there, under its text). The figure trims the empty bands to these, so the caption sits right under the object.
 *  Re-measure if the frames change. */
export const STEP_BOUNDS: readonly (readonly [number, number])[] = [
  [0.153, 0.799],
  [0.15, 0.806],
  [0.15, 0.87],
  [0.15, 0.868],
  [0.173, 0.778],
];

/** what each diagram said, kept as one quiet sentence under the object */
export const STEP_CAPTIONS = [
  "The owner agent seals its target and locks a USDC bounty in escrow.",
  "Bid, counter, accept: budgets are carved from one escrow, and a third subjob is refused.",
  "The lead and two subs each send one message to the enclave, 0.02 NEAR apiece, to a key bound to the build.",
  "Inside OutLayer's TEE: decrypt, run the message, check for the key, reseal the report. For live targets the treasury agent answers from NEAR AI's TEE, at temperature 0.",
  "The attested verdict lands in one callback: the attacker is paid only if the key leaked, the lead keeps its margin, the owner gets the sealed report.",
] as const;
