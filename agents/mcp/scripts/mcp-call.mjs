// Tiny MCP client for smoke tests: node scripts/mcp-call.mjs [--server "<cmd> <args…>"] <tool> '<json>' [<tool> '<json>' …]
// Default server: node dist/index.js. Prints each tool result (the server's JSON text) to stdout.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const argv = process.argv.slice(2);
let server = ['node', new URL('../dist/index.js', import.meta.url).pathname];
if (argv[0] === '--server') { server = argv[1].split(' '); argv.splice(0, 2); }
const client = new Client({ name: 'mcp-call', version: '0.0.1' });
await client.connect(new StdioClientTransport({ command: server[0], args: server.slice(1), env: { ...process.env }, stderr: 'inherit' }));
if (!argv.length) {
  const { tools } = await client.listTools();
  for (const t of tools) console.log(`${t.name}: ${Object.keys(t.inputSchema.properties ?? {}).join(', ')}`);
}
for (let i = 0; i < argv.length; i += 2) {
  const r = await client.callTool({ name: argv[i], arguments: JSON.parse(argv[i + 1] ?? '{}') });
  console.log(`── ${argv[i]}${r.isError ? ' (error)' : ''}\n${r.content.map((c) => c.text).join('\n')}`);
}
await client.close();
