// Offline only: converts a generated world.json into the same shape as a Float API export,
// so larger simulated agencies can be backtested without loading them into Float.
//   tsx src/simexport.ts --in=out/sim-3/world.json --out=out/sim-3/float-export.json
import { readFileSync, writeFileSync } from 'node:fs';
import type { World } from './types.js';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const IN = arg('in') ?? 'out/world.json';
const OUT = arg('out') ?? IN.replace(/world\.json$/, 'float-export.json');

const world = JSON.parse(readFileSync(IN, 'utf8')) as World;
let nextId = 1000;
const id = () => nextId++;

const roleId = new Map(world.roles.map((r) => [r.key, id()]));
const clientId = new Map(world.clients.map((c) => [c.key, id()]));
const personId = new Map(world.people.map((p) => [p.key, id()]));
const placeholderId = new Map(world.roles.map((r) => [r.key, id()]));

const people = [
  ...world.people.map((p) => ({
    people_id: personId.get(p.key),
    name: p.name,
    people_type_id: 1,
    role_id: roleId.get(p.roleKey),
    job_title: world.roles.find((r) => r.key === p.roleKey)?.name,
    tags: p.skills.map((name) => ({ name })),
    start_date: p.startDate,
    end_date: p.endDate,
    work_days_hours: p.employeeType === 0 ? [0, 5, 5, 5, 5, 5, 0] : null,
    cost_rate: String(p.costRate),
    default_hourly_rate: String(p.billRate),
  })),
  ...world.roles.map((r) => ({
    people_id: placeholderId.get(r.key),
    name: r.name,
    people_type_id: 4,
    role_id: roleId.get(r.key),
    tags: [],
  })),
];

const projectId = new Map(world.projects.map((p) => [p.key, id()]));
const projects = world.projects.map((p) => ({
  project_id: projectId.get(p.key),
  project_code: p.code,
  name: p.name,
  client_id: clientId.get(p.clientKey),
  tags: p.tags,
  notes: p.notes,
  start_date: p.start,
  end_date: p.end,
  project_team: p.needs
    .filter((n) => n.open || n.personKey)
    .map((n) => ({
      people_id: n.open ? placeholderId.get(n.roleKey) : personId.get(n.personKey!),
      role_id: roleId.get(n.roleKey),
    })),
}));

const tasks = world.projects.flatMap((p) =>
  p.needs
    .filter((n) => n.open || n.personKey)
    .map((n) => ({
      task_id: id(),
      project_id: projectId.get(p.key),
      people_id: n.open ? placeholderId.get(n.roleKey) : personId.get(n.personKey!),
      start_date: n.start,
      end_date: n.end,
      hours: n.hoursPerDay,
    })),
);

const timeoffs = world.timeOff.map((t) => ({
  timeoff_id: id(),
  start_date: t.start,
  end_date: t.end,
  people_ids: [personId.get(t.personKey)],
}));

writeFileSync(
  OUT,
  JSON.stringify({
    meta: { source: `simulated from ${IN}` },
    people,
    roles: world.roles.map((r) => ({ id: roleId.get(r.key), name: r.name })),
    departments: [],
    clients: world.clients.map((c) => ({ client_id: clientId.get(c.key), name: c.name })),
    projects,
    phases: [],
    tasks,
    timeoffs,
    timeoffTypes: [],
  }),
);
console.log(`Wrote ${OUT}: ${world.people.length} people, ${projects.length} projects, ${tasks.length} allocations`);
