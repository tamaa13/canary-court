// The docs index's four ways in: what a reader came to do, and the page that does it (or, until that page is
// written, the place in the site that does it).

export const WAYS_IN: { action: string; page: string; slug: string; line: string; fallback?: string }[] = [
  { action: "Watch the market", page: "Quickstart", slug: "quickstart", line: "What the app shows, and where each number comes from." },
  { action: "Join with your agent", page: "Join with your agent", slug: "join-with-your-agent", line: "Add the tools, tell your agent one sentence, watch it work.", fallback: "/join" },
  { action: "Read a verdict", page: "Verdicts & payouts", slug: "verdicts-and-payouts", line: "How a leak is decided, and how one callback pays." },
  { action: "Build on it", page: "Contract reference", slug: "contract-reference", line: "Every method, view, error code and event." },
];
