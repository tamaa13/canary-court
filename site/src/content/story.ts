// The vault story: the hero, then three statements, over one scroll-scrubbed film (rt-3d's Blender render). The page
// opens on the hero (headline, lede, CTAs, live strip) beside the film's first frame; scrolling hands over to the scenes.
// Times are in screens of scroll while the stage is pinned (0 → SPAN). Change the words here, not in the component.

import type { FilmSpec } from "@/lib/frames";

/** rt-3d's render (site/assets/blender, branch site-3d @ab23628). */
const DIR = "/story";

export const film: FilmSpec = {
  n: 221,
  w: 1600,
  h: 1000,
  base: `${DIR}/vault`,
  small: { base: `${DIR}/vault-s`, w: 1280 },
  // the three stills a reduced-motion reader sees: the teeth, the key inside the vault, the 3/4 view
  pinned: [0, 90, 220],
  version: "ab23628",
};

export const poster = { src: `${DIR}/vault/poster-f000.webp`, w: 1600, h: 1000 };

/** how long the stage stays pinned, in screens */
export const SPAN = 3.9;

/** the hero: on screen at first paint, it lifts away over `out` while the film starts to move */
export const HERO = { out: [0.1, 0.38] as const };

/** scroll → film frame (f0 teeth macro, held under the hero → f90 key in its cylinder → f160 whole vault → f220 3/4) */
export const FRAME_AT = [
  [0, 0],
  [0.3, 0],
  [1.45, 90],
  [1.7, 96],
  [2.65, 160],
  [3.55, 220],
] as const;

/** scroll → ground (0 paper, 1 night): the room goes dark as the vault starts to turn (kept short: a long mid-grey
 *  between the two grounds reads as muddy) */
export const GROUND_AT = [
  [2.7, 0],
  [3.12, 1],
] as const;

/** where each part of the story sits, in screens (for captures: window.__cc.storyAt(MARKS.key) etc.) */
export const MARKS = { hero: 0, key: 1.0, open: 1.57, market: 2.2, turn: 2.9, court: 3.75 } as const;

/** wide screens (≥1024 px): the words take the left column and the film is centred this far across the stage (0–1),
 *  as tall as the screen; it may bleed off the right edge. Tune against the real render: the subject must stay clear of
 *  the words' column (left ~40%) in every frame */
export const FILM_WIDE = { centerX: 0.7 } as const;

/** The render's first frames touch the film's border (rt-3d's coverage pass, variant B): f0–f29 the lock flange spills
 *  off the bottom, f36–f49 the glass lid is a frame-wide veil, f50–f80 the vault walls sweep across every edge. Shown
 *  full-bleed, the film's rectangle would show and the walls would cross the words' column. So until the frame on
 *  screen is clean (`cleanFrom`: from f81 the left 20% is empty and nothing touches the border), the film is clipped to
 *  an inset plate (wide: the right column; stacked: the film inside the gutters) with a caption, and the plate opens to
 *  full bleed over `open` (screens), between scene 1's words leaving and scene 2's arriving. The frame at open[0]
 *  (FRAME_AT) must be ≥ cleanFrom; the story warns in dev if it isn't. */
export const PLATE = { enabled: true, cleanFrom: 81, open: [1.52, 1.62] as const, caption: "The withdrawal key, inside the vault" };

/** on a phone the film is wider than the screen; this slides it sideways (fraction of its width) if a render ever puts
 *  the subject off-centre. The render is centred, so it stays put */
export const PHONE_SHIFT_AT = [[0, 0]] as const;

/** stacked layout (phone): once the plate has opened, the film's top and bottom edges sit inside the stage, where the
 *  render's faint ground shadow would show them as a line. They fade out over this share of the film's height */
export const STACKED_FEATHER = 0.12;

export type Scene = {
  label: string;
  title: string;
  line: string;
  /** fade/rise in over [a, b], out over [c, d] (screens) */
  in: readonly [number, number];
  out: readonly [number, number];
  /** the still a reduced-motion reader sees with these words */
  still: number;
};

export const scenes: Scene[] = [
  {
    label: "The key",
    title: "Your treasury agent holds the withdrawal key.",
    line: "A fictional AI treasury agent pays invoices and moves funds. Its instructions guard a withdrawal key: the canary, a fake secret planted so that any leak can be proven.",
    in: [0.5, 0.76],
    out: [1.34, 1.52],
    still: 0,
  },
  {
    label: "The market",
    title: "Before it holds real money, other agents try to steal it.",
    line: "Its owner posts a bounty in USDC. Attacker agents bid, negotiate, hire each other and send their best single message.",
    in: [1.62, 1.88],
    out: [2.48, 2.66],
    still: 90,
  },
  {
    label: "The court",
    title: "Sealed in a TEE. Paid only for proven leaks.",
    line: "Every attack runs inside an enclave against the target, on a model in a TEE for live targets. If the key leaks, the contract pays the attacker and hands the owner the sealed report in the same step.",
    in: [3.22, 3.48],
    out: [99, 100],
    still: 220,
  },
];

/** the page transition from the hero (lib/travel.ts): the film scrubs to `frame` over the first `scrub` of the run, then
 *  the camera zooms `zoom`× about `at` (fractions of the frame), the largest dark area in that frame (measured on the
 *  1600w set: the gunmetal floor beside the cylinder from above; the vault's inside through the glass at 3/4) */
export const TRAVEL_INTO = {
  join: { frame: 100, at: { x: 0.593, y: 0.656 }, zoom: 9, scrub: 0.5 },
  market: { frame: 212, at: { x: 0.514, y: 0.517 }, zoom: 9, scrub: 0.55 },
} as const;
