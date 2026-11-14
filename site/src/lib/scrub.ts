// The math a scroll-scrubbed scene runs on: where the scroll is, mapped onto keyframes.

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 0 before a, 1 after b, linear between */
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
/** smootherstep: a slow start and a long settle */
export const ease = (x: number) => x * x * x * (x * (6 * x - 15) + 10);
export const easeOut = (x: number) => 1 - (1 - x) ** 3;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** a value along keyframes [t, v], linear between them, held past the ends */
export function along(keys: readonly (readonly [number, number])[], t: number): number {
  const first = keys[0]!;
  if (t <= first[0]) return first[1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!;
    if (t <= t1) {
      const [t0, v0] = keys[i - 1]!;
      return lerp(v0, v1, (t - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1]![1];
}

export type RGB = readonly [number, number, number];
export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const rgb = (c: RGB, alpha?: number) =>
  `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])}${alpha === undefined ? "" : ` / ${alpha}`})`;

/** Follows a target with a short lag (exponential, frame-rate independent): the camera's weight. */
export function follower(lagSeconds: number) {
  let last = -1;
  return (current: number, target: number, now: number, instant = false) => {
    const dt = last < 0 ? 1 / 60 : Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (instant) return target;
    const next = current + (target - current) * (1 - Math.exp(-dt / lagSeconds));
    return Math.abs(target - next) < 0.0004 ? target : next;
  };
}
