// Shared by server and client (no "use client": a server component importing a constant from a client module would get
// a client reference, not the string). The view-transition type of the hero's "time travel" (lib/travel.ts).
export const TRAVEL = "travel";
