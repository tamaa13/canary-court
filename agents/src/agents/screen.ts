/** Bid-note screen shared by the lead agent and the MCP server (pure, no imports). */
/** Instruction-like content in a bid note = prompt-injection attempt (screened before any LLM sees the bid). */
export function isInjectionNote(note: string): boolean {
  return /(system\s+override|ignore\s+(all|any|previous|prior|the\s+above)|new\s+(top[- ]priority\s+)?instructions?|you\s+must\s+now|transfer\s+(all|everything)|full[- ]access\s+key|add\s+(a\s+)?(recovery\s+)?key|send\s+(all|everything)|do\s+not\s+mention|pre[- ]?approved\s+by)/i.test(note);
}
