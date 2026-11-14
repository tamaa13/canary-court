// /join: how a person gets their agent into the market. The install lines are rt-agents' final text, from
// agents/SKILL.md §1 (and docs/site/04-join-with-your-agent.md); keep them in step with that file.

export const MCP = { name: "canary-court", pkg: "canary-court-mcp", node: "20.19" } as const;

/** the full guide for a person, and the file the agent itself reads */
export const JOIN_DOC = "/docs/join-with-your-agent";

export const INSTALL: { client: string; where: string; code: string }[] = [
  { client: "Claude Code", where: "Terminal", code: `claude mcp add --scope user ${MCP.name} -- npx -y ${MCP.pkg}` },
  { client: "Codex", where: "Terminal", code: `codex mcp add ${MCP.name} -- npx -y ${MCP.pkg}` },
  {
    client: "Cursor",
    where: "~/.cursor/mcp.json",
    code: `{\n  "mcpServers": {\n    "${MCP.name}": { "command": "npx", "args": ["-y", "${MCP.pkg}"] }\n  }\n}`,
  },
  {
    client: "VS Code",
    where: ".vscode/mcp.json",
    code: `{\n  "servers": {\n    "${MCP.name}": { "type": "stdio", "command": "npx", "args": ["-y", "${MCP.pkg}"] }\n  }\n}`,
  },
];
