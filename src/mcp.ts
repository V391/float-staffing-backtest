// MCP server: ask "who should fill this role?" against Float data from Claude, ChatGPT or any MCP client.
// Read-only. It ranks people on role fit, availability and past work, and says why.
// Float's own MCP can't do this: Smart assign isn't exposed through Float's public API.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadData, type Data, type Project } from './data.js';
import { buildDecisions, recommend, toGroups, type Recommendation } from './engine.js';
import { FeatureBuilder, type Decision } from './features.js';
import { ExperienceModel } from './models.js';

// Run from the project root so .env and out/ resolve however the client launches us.
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const EXPORT = 'out/float-export.json';
const today = () => new Date().toISOString().slice(0, 10);

let data: Data;
let fb: FeatureBuilder;
let model: ExperienceModel;
let trainedOn = 0;

function train() {
  data = loadData(EXPORT);
  fb = new FeatureBuilder(data);
  model = new ExperienceModel();
  const { groups } = toGroups(fb, buildDecisions(data, today()));
  model.fit(groups);
  trainedOn = groups.length;
  console.error(`float-nextgen: trained on ${trainedOn} past staffing decisions`);
}

if (!existsSync(EXPORT)) {
  console.error(`float-nextgen: ${EXPORT} not found. Run \`npm run pull\` first.`);
  process.exit(1);
}
train();

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

function formatRecs(header: string, d: Decision, r: ReturnType<typeof recommend>): string {
  const lines = [
    header,
    `${d.start} to ${d.end}, ${d.hours}h/day. ${r.pool} people free enough to take it.`,
    '',
    ...r.experience.map(
      (e: Recommendation, i: number) => `${i + 1}. ${e.name} (${e.role}): ${e.why.join('; ') || 'closest overall fit'}`,
    ),
    '',
    `Title and availability only (how Smart assign ranks): ${r.titleAndAvailability.join(', ')}`,
  ];
  return lines.join('\n');
}

const server = new McpServer({ name: 'float-nextgen', version: '0.1.0' });

// The SDK's generic inference over zod shapes hits TypeScript's depth limit (TS2589),
// so tools are registered through a narrower signature with explicitly typed args.
type ToolResult = ReturnType<typeof text>;
const registerTool = server.registerTool.bind(server) as unknown as <A>(
  name: string,
  config: { title: string; description: string; inputSchema: z.ZodRawShape },
  handler: (args: A) => Promise<ToolResult>,
) => void;

registerTool(
  'list_open_roles',
  {
    title: 'List open roles',
    description: 'Unfilled roles on upcoming Float projects (role placeholders), with dates and hours.',
    inputSchema: {},
  },
  async () => {
    const open = buildDecisions(data, today()).filter((d) => d.open);
    if (!open.length) return text('No open roles found.');
    const byProject = new Map<string, Decision[]>();
    for (const d of open) byProject.set(d.project.code, [...(byProject.get(d.project.code) ?? []), d]);
    const lines = [...byProject.values()].map((ds) => {
      const p = ds[0]!.project;
      return `${p.code} ${p.name} (${p.clientName}, starts ${p.start}): ${ds.map((d) => d.roleName).join(', ')}`;
    });
    return text(`${open.length} open roles on ${byProject.size} projects:\n${lines.join('\n')}`);
  },
);

registerTool<{ project_code: string; role?: string; top_k?: number }>(
  'recommend_people',
  {
    title: 'Recommend people for an open role',
    description:
      'Ranks who should fill an open role on a Float project, using role fit, availability, past work for the same client, similar past projects, skills and who they have worked with. Explains each pick.',
    inputSchema: {
      project_code: z.string().describe('Float project code, e.g. KST-P085'),
      role: z.string().optional().describe('Role name, e.g. "Senior Designer". Omit to cover every open role.'),
      top_k: z.number().int().min(1).max(10).optional().describe('How many people to return per role (default 5)'),
    },
  },
  async ({ project_code, role, top_k }) => {
    const open = buildDecisions(data, today()).filter(
      (d) =>
        d.open &&
        d.project.code.toLowerCase() === project_code.toLowerCase() &&
        (!role || d.roleName.toLowerCase() === role.toLowerCase()),
    );
    if (!open.length) return text(`No open roles found for ${project_code}${role ? ` / ${role}` : ''}. Try list_open_roles.`);
    const blocks = open.map((d) =>
      formatRecs(`${d.roleName} on ${d.project.name} (${d.project.clientName})`, d, recommend(fb, model, d, top_k ?? 5)),
    );
    return text(blocks.join('\n\n---\n\n'));
  },
);

registerTool<{
  role: string;
  start: string;
  end: string;
  client?: string;
  description?: string;
  tags?: string[];
  hours_per_day?: number;
  top_k?: number;
}>(
  'recommend_for_brief',
  {
    title: 'Recommend people for a new piece of work',
    description:
      'Who should fill a role on work that is not in Float yet. Describe the role, client, dates and the work; get a ranked, explained shortlist.',
    inputSchema: {
      role: z.string().describe('Role name as used in Float, e.g. "Art Director"'),
      start: z.string().describe('Start date, YYYY-MM-DD'),
      end: z.string().describe('End date, YYYY-MM-DD'),
      client: z.string().optional().describe('Client name, if it is an existing Float client'),
      description: z.string().optional().describe('What the work is, e.g. "Shopify checkout redesign"'),
      tags: z.array(z.string()).optional().describe('Industry or tech tags, e.g. ["retail", "shopify"]'),
      hours_per_day: z.number().min(0.5).max(12).optional().describe('Hours per day (default 4)'),
      top_k: z.number().int().min(1).max(10).optional(),
    },
  },
  async ({ role, start, end, client, description, tags, hours_per_day, top_k }) => {
    const roleEntry = [...data.roleName].find(([, name]) => name.toLowerCase() === role.toLowerCase());
    if (!roleEntry) return text(`Unknown role "${role}". Roles in Float: ${[...data.roleName.values()].join(', ')}`);
    const clientProject = client
      ? [...data.projects.values()].find((p) => p.clientName.toLowerCase().includes(client.toLowerCase()))
      : undefined;
    const project: Project = {
      id: -1,
      code: 'BRIEF',
      name: description ?? `${role} brief`,
      clientId: clientProject?.clientId ?? null,
      clientName: clientProject?.clientName ?? client ?? '',
      tags: (tags ?? []).map((t) => t.toLowerCase()),
      notes: description ?? '',
      start,
      end,
      team: [],
    };
    const d: Decision = {
      key: 'brief',
      project,
      roleId: roleEntry[0],
      roleName: roleEntry[1],
      start,
      end,
      hours: hours_per_day ?? 4,
      chosenId: null,
      open: true,
      asOf: today(),
    };
    const note = client && !clientProject ? `\n(No Float client matched "${client}", so client history was not used.)` : '';
    return text(formatRecs(`${roleEntry[1]} for "${project.name}"`, d, recommend(fb, model, d, top_k ?? 5)) + note);
  },
);

registerTool(
  'refresh_from_float',
  {
    title: 'Refresh data from Float',
    description: 'Re-reads people, projects and allocations from the Float API (read-only) and retrains the ranking model.',
    inputSchema: {},
  },
  async () => {
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, ['--import', 'tsx', 'src/pull.ts'], { stdio: ['ignore', 'ignore', 'inherit'] });
    train();
    return text(`Refreshed from Float. Model retrained on ${trainedOn} past staffing decisions.`);
  },
);

await server.connect(new StdioServerTransport());
