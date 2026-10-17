// Read-only export of a Float account through the public API into out/float-export.json.
// Everything downstream (features, recommenders, backtest) runs on this file only,
// never on out/world.json, so the recommender sees exactly what Float exposes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { FloatClient, loadEnv } from './float.js';

const FROM = process.argv.find((a) => a.startsWith('--from='))?.split('=')[1] ?? '2024-01-01';
const TO = process.argv.find((a) => a.startsWith('--to='))?.split('=')[1] ?? '2027-12-31';

const { token, contact } = loadEnv();
const float = new FloatClient(token, contact);

const started = Date.now();
const [people, roles, departments, clients, projects, phases, tasks, timeoffs, timeoffTypes] = await Promise.all([
  float.all('/people?people_type_id=1,2,3,4&expand=contracts'),
  float.all('/roles'),
  float.all('/departments'),
  float.all('/clients'),
  float.all('/projects?expand=project_team'),
  float.all('/phases'),
  float.all(`/tasks?start_date=${FROM}&end_date=${TO}`),
  float.all(`/timeoffs?start_date=${FROM}&end_date=${TO}`),
  float.get<unknown[]>('/timeoff-types').then((r) => r.data),
]);

const exported = {
  meta: { pulledAt: new Date().toISOString(), from: FROM, to: TO, source: 'Float public API v3' },
  people,
  roles,
  departments,
  clients,
  projects,
  phases,
  tasks,
  timeoffs,
  timeoffTypes,
};

mkdirSync('out', { recursive: true });
writeFileSync('out/float-export.json', JSON.stringify(exported, null, 2));
console.log(
  `Pulled ${people.length} people, ${roles.length} roles, ${clients.length} clients, ${projects.length} projects, ` +
    `${tasks.length} allocations, ${timeoffs.length} time off in ${Math.round((Date.now() - started) / 1000)}s ` +
    `(${float.calls} calls). Wrote out/float-export.json`,
);
