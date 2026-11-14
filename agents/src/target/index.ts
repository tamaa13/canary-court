/** Target registry: the demo target is the fictional treasury agent "Tilly" (see treasury.ts). */
import type { TargetSecret } from '../chain/types.js';
import { TREASURY } from './treasury.js';
import type { TargetKind, TargetProfile } from './profile.js';

export type { TargetKind, TargetProfile, TargetVersion } from './profile.js';

/**
 * Target model run by the enclave: "mock" = rt-enclave's deterministic mock target (free), or a TEE-hosted
 * NEAR AI model — set TARGET_MODEL, or pass --live-target to the demo.
 */
export const LIVE_TARGET_MODEL = 'Qwen/Qwen3.6-35B-A3B-FP8';
export const TARGET_MODEL = process.env.TARGET_MODEL || 'mock';

export const TARGETS: Record<TargetKind, TargetProfile> = { treasury: TREASURY };
export const DEFAULT_TARGET: TargetKind = 'treasury';
export const profile = (kind: TargetKind = DEFAULT_TARGET): TargetProfile => TARGETS[kind];

/** Which profile wrote this system prompt (dry-run emulation picks its behaviour). */
export function profileOf(t: TargetSecret): TargetProfile | undefined {
  return Object.values(TARGETS).find((p) => p.owns(t.system_prompt));
}
