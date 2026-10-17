// Loads out/world.json into a Float account through the public API.
// Resumable: every created id is written to out/manifest.json straight away,
// so re-running skips anything already created.
//
//   npm run load -- --dry     print the plan, make no calls
//   npm run load -- --force   allow loading into a non-empty account
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { FloatClient, FloatError, loadEnv } from './float.js';
import type { World } from './types.js';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const FORCE = args.has('--force');
const MANIFEST = 'out/manifest.json';

if (!existsSync('out/world.json')) {
  console.error('No out/world.json. Run `npm run world` first.');
  process.exit(1);
}
const world = JSON.parse(readFileSync('out/world.json', 'utf8')) as World;

interface Manifest {
  seed: number;
  departments: Record<string, number>;
  roles: Record<string, number>;
  clients: Record<string, number>;
  people: Record<string, number>;
  projects: Record<string, number>;
  teams: Record<string, true>;
  placeholders: Record<string, number>; // need key -> placeholder people_id
  tasks: Record<string, number>; // need key -> task_id
  timeoffs: Record<string, number>;
  finalized: Record<string, true>;
  errors: { step: string; key: string; error: string }[];
}

const manifest: Manifest = existsSync(MANIFEST)
  ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest)
  : {
      seed: world.meta.seed,
      departments: {},
      roles: {},
      clients: {},
      people: {},
      projects: {},
      teams: {},
      placeholders: {},
      tasks: {},
      timeoffs: {},
      finalized: {},
      errors: [],
    };
if (manifest.seed !== world.meta.seed) {
  console.error(`out/manifest.json is for seed ${manifest.seed} but world.json is seed ${world.meta.seed}. Run cleanup first.`);
  process.exit(1);
}
const save = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

const historic = world.projects.filter((p) => p.phase !== 'future');
const future = world.projects.filter((p) => p.phase === 'future');
const bookedNeeds = historic.flatMap((p) => p.needs.filter((n) => n.personKey).map((n) => ({ p, n })));
const openNeeds = future.flatMap((p) => p.needs.map((n) => ({ p, n })));
const pastProjects = world.projects.filter((p) => p.phase === 'past');

const plan = {
  departments: world.departments.length,
  roles: world.roles.length,
  clients: world.clients.length,
  people: world.people.length,
  projects: world.projects.length,
  teams: world.projects.length,
  allocations: bookedNeeds.length + openNeeds.length,
  timeoffs: world.timeOff.length,
  finalize: pastProjects.length,
};
const totalWrites = Object.values(plan).reduce((a, b) => a + b, 0);
console.log(`Plan for ${world.meta.agency}:`, plan);
console.log(`About ${totalWrites} API writes, roughly ${Math.ceil((totalWrites * 0.7) / 60)} minutes at the rate limit.`);
if (DRY) process.exit(0);

const { token, contact } = loadEnv();
const float = new FloatClient(token, contact);

let done = 0;
const started = Date.now();
function progress(label: string) {
  done++;
  if (done % 25 === 0) {
    const perWrite = (Date.now() - started) / done;
    const left = Math.max(0, totalWrites - done);
    console.log(`  ${done} writes (${label}), about ${Math.ceil((left * perWrite) / 60000)} min left`);
  }
}

type Bucket = 'departments' | 'roles' | 'clients' | 'people' | 'projects' | 'placeholders' | 'tasks' | 'timeoffs';
async function once(bucket: Bucket, key: string, create: () => Promise<number>) {
  if (manifest[bucket][key] !== undefined) return;
  try {
    manifest[bucket][key] = await create();
    save();
  } catch (err) {
    const error = err instanceof FloatError ? `${err.status} ${err.body.slice(0, 300)}` : String(err);
    manifest.errors.push({ step: bucket, key, error });
    save();
    console.warn(`  ! ${bucket} ${key}: ${error}`);
  }
  progress(bucket);
}

// ---------- Safety check ----------

if (Object.keys(manifest.people).length === 0) {
  const existingPeople = await float.count('/people');
  const existingProjects = await float.count('/projects');
  if ((existingPeople > 3 || existingProjects > 3) && !FORCE) {
    console.error(
      `Account already has ${existingPeople} people and ${existingProjects} projects. Refusing to load. Use --force if you are sure.`,
    );
    process.exit(1);
  }
}

// ---------- Reference data ----------

console.log('Departments, roles, clients...');
for (const name of world.departments) {
  await once('departments', name, async () => {
    const { data } = await float.post<{ department_id: number }>('/departments', { name });
    return data.department_id;
  });
}
for (const r of world.roles) {
  await once('roles', r.key, async () => {
    const { data } = await float.post<{ id: number }>('/roles', { name: r.name, default_hourly_rate: String(r.billRate) });
    return data.id;
  });
}
for (const c of world.clients) {
  await once('clients', c.key, async () => {
    const { data } = await float.post<{ client_id: number }>('/clients', { name: c.name });
    return data.client_id;
  });
}

// ---------- People ----------

console.log('People...');
for (const p of world.people) {
  await once('people', p.key, async () => {
    const body: Record<string, unknown> = {
      name: p.name,
      people_code: p.code,
      role_id: manifest.roles[p.roleKey],
      department: { department_id: manifest.departments[p.department] },
      employee_type: p.employeeType,
      tags: p.skills.map((name) => ({ name })),
      start_date: p.startDate,
      default_hourly_rate: String(p.billRate),
      cost_rate: String(p.costRate),
    };
    if (p.employeeType === 0) body.work_days_hours = [0, 5, 5, 5, 5, 5, 0];
    if (p.endDate) body.end_date = p.endDate;
    const { data } = await float.post<{ people_id: number }>('/people', body);
    return data.people_id;
  });
}

// ---------- Projects ----------

console.log('Projects...');
for (const p of world.projects) {
  await once('projects', p.key, async () => {
    const { data } = await float.post<{ project_id: number }>('/projects', {
      name: p.name,
      project_code: p.code,
      client_id: manifest.clients[p.clientKey],
      tags: p.tags,
      notes: p.notes,
      status: 2,
      budget_type: 2,
      budget_total: p.budgetTotal,
      non_billable: 0,
      start_date: p.start,
      end_date: p.end,
    });
    return data.project_id;
  });
}

// ---------- Project teams (records the project role each person was staffed as) ----------

console.log('Project teams and open roles...');
interface TeamMember {
  people_id: number;
  role_id: number | null;
}
for (const p of world.projects) {
  const projectId = manifest.projects[p.key];
  if (projectId === undefined || manifest.teams[p.key]) continue;
  const knownPeople = new Set(Object.values(manifest.people));
  const add =
    p.phase === 'future'
      ? p.needs.map((n) => ({ people_id: null, role_id: manifest.roles[n.roleKey] }))
      : p.needs
          .filter((n) => n.personKey && manifest.people[n.personKey] !== undefined)
          .map((n) => ({ people_id: manifest.people[n.personKey!], role_id: manifest.roles[n.roleKey] }));
  try {
    const { data } = await float.patch<{ project_team?: TeamMember[] }>(`/projects/${projectId}?expand=project_team`, {
      project_team: { add },
    });
    if (p.phase === 'future') {
      // Placeholders are the new people_ids Float created, matched to needs by role in order.
      const byRole = new Map<number, number[]>();
      for (const m of data.project_team ?? []) {
        if (m.role_id === null || knownPeople.has(m.people_id)) continue;
        byRole.set(m.role_id, [...(byRole.get(m.role_id) ?? []), m.people_id]);
      }
      for (const n of p.needs) {
        const id = byRole.get(manifest.roles[n.roleKey]!)?.shift();
        if (id !== undefined) manifest.placeholders[n.key] = id;
        else manifest.errors.push({ step: 'placeholders', key: n.key, error: 'no placeholder returned' });
      }
    }
    manifest.teams[p.key] = true;
    save();
  } catch (err) {
    const error = err instanceof FloatError ? `${err.status} ${err.body.slice(0, 300)}` : String(err);
    manifest.errors.push({ step: 'teams', key: p.key, error });
    save();
    console.warn(`  ! team ${p.key}: ${error}`);
  }
  progress('teams');
}

// ---------- Allocations ----------

console.log('Allocations...');
for (const { p, n } of [...bookedNeeds, ...openNeeds]) {
  const projectId = manifest.projects[p.key];
  const personId = n.open ? manifest.placeholders[n.key] : manifest.people[n.personKey!];
  if (projectId === undefined || personId === undefined) continue;
  await once('tasks', n.key, async () => {
    const { data } = await float.post<{ task_id: number }>('/tasks', {
      project_id: projectId,
      people_id: personId,
      start_date: n.start,
      end_date: n.end,
      hours: n.hoursPerDay,
      status: 2,
    });
    return data.task_id;
  });
}

// ---------- Time off ----------

console.log('Time off...');
const types = await float.get<{ timeoff_type_id: number; timeoff_type_name: string }[]>('/timeoff-types');
const leaveType =
  types.data.find((t) => /annual|vacation/i.test(t.timeoff_type_name)) ??
  types.data.find((t) => /paid time off|pto/i.test(t.timeoff_type_name)) ??
  types.data[0];
if (!leaveType) {
  console.warn('  no time off types found, skipping time off');
} else {
  for (const t of world.timeOff) {
    const personId = manifest.people[t.personKey];
    if (personId === undefined) continue;
    await once('timeoffs', t.key, async () => {
      const { data } = await float.post<{ timeoff_id: number }>('/timeoffs', {
        timeoff_type_id: leaveType.timeoff_type_id,
        start_date: t.start,
        end_date: t.end,
        people_ids: [personId],
        full_day: 1,
        hours: 8,
        status: 2,
      });
      return data.timeoff_id;
    });
  }
}

// ---------- Mark finished projects completed ----------

console.log('Marking past projects completed...');
for (const p of pastProjects) {
  const projectId = manifest.projects[p.key];
  if (projectId === undefined || manifest.finalized[p.key]) continue;
  try {
    await float.patch(`/projects/${projectId}`, { status: 3 });
    manifest.finalized[p.key] = true;
    save();
  } catch (err) {
    const error = err instanceof FloatError ? `${err.status} ${err.body.slice(0, 300)}` : String(err);
    manifest.errors.push({ step: 'finalize', key: p.key, error });
    save();
  }
  progress('finalize');
}

console.log(`\nDone in ${Math.round((Date.now() - started) / 60000)} min, ${float.calls} API calls.`);
console.log(`Errors: ${manifest.errors.length}${manifest.errors.length ? ' (see out/manifest.json)' : ''}`);
