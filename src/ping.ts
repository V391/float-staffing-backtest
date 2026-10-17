// Read-only check: is the token valid, and is the account empty enough to seed?
import { FloatClient, FloatError, loadEnv } from './float.js';

const { token, contact } = loadEnv();
const float = new FloatClient(token, contact);

try {
  const [people, projects, clients, roles, departments] = await Promise.all([
    float.count('/people'),
    float.count('/projects'),
    float.count('/clients'),
    float.count('/roles'),
    float.count('/departments'),
  ]);
  const types = await float.get<{ timeoff_type_id: number; timeoff_type_name: string }[]>('/timeoff-types');
  console.log('Token works. Current account contents:');
  console.log(`  people ${people}, projects ${projects}, clients ${clients}, roles ${roles}, departments ${departments}`);
  console.log(`  time off types: ${types.data.map((t) => t.timeoff_type_name).join(', ') || 'none'}`);
  if (people > 3 || projects > 3) {
    console.log('\nThis account is not empty. `npm run load` will refuse to run unless you pass --force.');
  } else {
    console.log('\nLooks empty. Safe to run `npm run load`.');
  }
} catch (err) {
  if (err instanceof FloatError && (err.status === 401 || err.status === 403)) {
    console.error(`Float rejected the token (${err.status}). Check FLOAT_API_TOKEN, and that your plan allows API access.`);
  } else {
    console.error(err);
  }
  process.exit(1);
}
