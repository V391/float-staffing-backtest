// Starts the MCP server over stdio and calls each tool once, like Claude would.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'smoke', version: '0.0.1' });
await client.connect(
  new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/mcp.ts'], stderr: 'inherit' }),
);

const { tools } = await client.listTools();
console.log('Tools:', tools.map((t) => t.name).join(', '));

const show = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as { type: string; text: string }[];
  console.log(`\n=== ${name} ${JSON.stringify(args)}\n${content.map((c) => c.text).join('\n')}`);
};

await show('list_open_roles');
await show('recommend_people', { project_code: 'KST-P083', role: 'Senior Designer', top_k: 3 });
await show('recommend_for_brief', {
  role: 'Senior Designer',
  client: 'Stride Athletics',
  start: '2027-01-11',
  end: '2027-03-05',
  description: 'Spring campaign for a running shoe launch: hero film and social',
  tags: ['sportswear', 'campaign'],
  top_k: 3,
});
await client.close();
