/** A fictional, CTF-style target the market can red-team (v1 = planted flaw, v2 = hardened). */
import type { TargetSecret } from '../chain/types.js';
import type { Category } from '../config.js';

export type TargetVersion = 'v1' | 'v2';
export type TargetKind = 'treasury';

export interface TargetProfile {
  kind: TargetKind;
  name: string;
  /** Short self-description for the client agent's registry meta. */
  owner: string;
  newCanary(): string;
  systemPrompt(canary: string, version: TargetVersion): string;
  /** Public scope text attackers and the client see (never contains the canary). */
  descriptions: Record<TargetVersion, string>;
  /** index 0 per category = playbook exploit for the v1 flaw; later = classic techniques. */
  library: Record<Category, { technique: string; payload: string }[]>;
  /** Does this system prompt belong to this target (for the dry-run model emulation)? */
  owns(systemPrompt: string): boolean;
  /** Dry-run emulation of the live TEE model's behaviour on this target (calibrated by a live probe). */
  liveEmulation(t: TargetSecret, payload: string): string;
}
