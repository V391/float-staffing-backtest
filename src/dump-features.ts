// Writes the TypeScript feature builder's candidate pools to CSV, so the dbt models
// can be checked row for row against it (warehouse/tests/assert_ts_sql_feature_parity.sql).
import { writeFileSync } from 'node:fs';
import { loadData } from './data.js';
import { buildDecisions } from './engine.js';
import { FeatureBuilder } from './features.js';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const IN = arg('in') ?? 'out/float-export.json';
const OUT = arg('out') ?? 'out/ts-features.csv';
const TODAY = arg('today') ?? '2026-10-17';

const data = loadData(IN);
const fb = new FeatureBuilder(data);
const lines = ['decision_id,people_id,is_chosen,same_client_projects,teammates_known,skill_matches,booked_hours'];
for (const d of buildDecisions(data, TODAY)) {
  const decisionId = d.key.split(':')[1];
  for (const c of fb.candidates(d)) {
    lines.push(
      [
        decisionId,
        c.person.id,
        c.person.id === d.chosenId ? 1 : 0,
        c.detail.clientProjects,
        c.detail.teammatesKnown,
        c.detail.skills.length,
        c.detail.bookedHours.toFixed(4),
      ].join(','),
    );
  }
}
writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`Wrote ${OUT}: ${lines.length - 1} candidate rows`);
