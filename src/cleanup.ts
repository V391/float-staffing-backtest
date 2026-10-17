// Deletes everything listed in out/manifest.json from Float, and nothing else.
// Irreversible, so it requires --yes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { FloatClient, FloatError, loadEnv } from './float.js';

const MANIFEST = 'out/manifest.json';
if (!existsSync(MANIFEST)) {
  console.log('No out/manifest.json, nothing to delete.');
  process.exit(0);
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, Record<string, number> | unknown>;

// Order matters: projects take their allocations and placeholders with them,
// people take their remaining allocations and logged time.
const steps: [bucket: string, path: (id: number) => string][] = [
  ['timeoffs', (id) => `/timeoffs/${id}`],
  ['projects', (id) => `/projects/${id}`],
  ['people', (id) => `/people/${id}`],
  ['clients', (id) => `/clients/${id}`],
  ['roles', (id) => `/roles/${id}`],
  ['departments', (id) => `/departments/${id}`],
];

const counts = steps.map(([b]) => `${b} ${Object.keys((manifest[b] as Record<string, number>) ?? {}).length}`);
console.log(`Will delete from Float: ${counts.join(', ')}`);
if (!process.argv.includes('--yes')) {
  console.log('This cannot be undone. Re-run with --yes to proceed: npm run cleanup -- --yes');
  process.exit(0);
}

const { token, contact } = loadEnv();
const float = new FloatClient(token, contact);

for (const [bucket, path] of steps) {
  const entries = (manifest[bucket] as Record<string, number>) ?? {};
  for (const [key, id] of Object.entries(entries)) {
    try {
      await float.del(path(id));
    } catch (err) {
      if (!(err instanceof FloatError && err.status === 404)) {
        console.warn(`  ! ${bucket} ${key}: ${err instanceof Error ? err.message : err}`);
        continue;
      }
    }
    delete entries[key];
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  }
  console.log(`  ${bucket} done`);
}
console.log('Cleanup finished. You can delete out/manifest.json.');
