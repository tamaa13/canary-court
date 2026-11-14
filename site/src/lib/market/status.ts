/** how much a status matters to the reader: "muted" ones are settled and quiet, the rest are set in ink. (Kept as
 *  ok/accent/bad/fg/muted so the call sites read; no colour is ever drawn from it.) */
export type Tone = "accent" | "ok" | "bad" | "fg" | "muted";

export const statusTone = (s: string): Tone =>
  (
    ({
      Valid: "fg",
      Allow: "fg",
      Accepted: "fg",
      Assigned: "fg",
      Open: "fg",
      Countered: "fg",
      Warn: "fg",
      Pending: "fg",
      Invalid: "fg",
      Block: "fg",
      Failed: "fg",
      Rejected: "muted",
      Expired: "muted",
      Closed: "muted",
    }) as Record<string, Tone>
  )[s] ?? "muted";
