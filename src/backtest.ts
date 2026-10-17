// Backtest: replay every historical staffing decision using only what was known at the time.
// Train the experience model on decisions before SPLIT, evaluate both rankers after it.
// Then score the 20 live open roles against Float's actual Smart assign picks.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadData } from './data.js';
import { buildDecisions, reasons, toGroups } from './engine.js';
import { FEATURES, FeatureBuilder, type Candidate } from './features.js';
import { ExperienceModel, baselineScore, rankOf, type Group } from './models.js';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const SPLIT = '2026-02-01';
const TODAY = '2026-10-17';
const IN = arg('in') ?? 'out/float-export.json';
const REPORT = arg('report') ?? 'out/backtest.json';
const LIVE = !process.argv.includes('--no-live');

const data = loadData(IN);
const fb = new FeatureBuilder(data);

// ---------- Decisions ----------

const decisions = buildDecisions(data, TODAY);
const history = decisions.filter((d) => !d.open);
const { groups, skipped: chosenFiltered } = toGroups(fb, decisions);

const train = groups.filter((g) => g.decision.start < SPLIT);
const test = groups.filter((g) => g.decision.start >= SPLIT);

// ---------- Train and evaluate ----------

const model = new ExperienceModel();
const { loss } = model.fit(train);

interface Metrics {
  n: number;
  hit1: number;
  hit3: number;
  mrr: number;
}
function evaluate(gs: Group[], score: (c: Candidate) => number): Metrics {
  const ranks = gs.map((g) => rankOf(g, score));
  const pct = (k: number) => Math.round((100 * ranks.filter((r) => r <= k).length) / ranks.length);
  return {
    n: gs.length,
    hit1: pct(1),
    hit3: pct(3),
    mrr: Math.round((100 * ranks.reduce((s, r) => s + 1 / r, 0)) / ranks.length) / 100,
  };
}
const randomHit3 = Math.round((100 * test.reduce((s, g) => s + Math.min(1, 3 / g.candidates.length), 0)) / test.length);
const results = {
  baseline: evaluate(test, baselineScore),
  experience: evaluate(test, (c) => model.score(c)),
};

// ---------- Live open roles vs Float's Smart assign ----------

interface LiveRow {
  project: string;
  role: string;
  truth: string;
  smartAssign: string[];
  baseline: string[];
  experience: { name: string; why: string[] }[];
}
const live: LiveRow[] = [];
if (LIVE && existsSync('data/smart-assign-capture.csv') && existsSync('out/world.json')) {
  // Hidden truth comes from the generator and is used only for scoring, never as a feature.
  const world = JSON.parse(readFileSync('out/world.json', 'utf8')) as {
    people: { key: string; name: string }[];
    roles: { key: string; name: string }[];
    projects: { code: string; needs: { roleKey: string; truthPersonKey: string | null }[] }[];
  };
  const nameByKey = new Map(world.people.map((p) => [p.key, p.name]));
  const roleNameByKey = new Map(world.roles.map((r) => [r.key, r.name]));
  const used = new Map<string, number>();
  const rows = readFileSync('data/smart-assign-capture.csv', 'utf8').trim().split('\n').slice(1);
  for (const line of rows) {
    const [code, role, p1, , p2, , p3] = line.split(',');
    const nth = used.get(`${code}|${role}`) ?? 0;
    used.set(`${code}|${role}`, nth + 1);
    const truthKey = world.projects
      .find((p) => p.code === code)
      ?.needs.filter((n) => roleNameByKey.get(n.roleKey) === role)[nth]?.truthPersonKey;
    const d = decisions.filter((x) => x.open && x.project.code === code && x.roleName === role)[nth];
    if (!d || !truthKey) continue;
    const cands = fb.candidates(d);
    const top = (score: (c: Candidate) => number) => [...cands].sort((a, b) => score(b) - score(a)).slice(0, 3);
    live.push({
      project: `${code} ${d.project.name}`,
      role: role!,
      truth: nameByKey.get(truthKey) ?? truthKey,
      smartAssign: [p1!, p2!, p3!],
      baseline: top(baselineScore).map((c) => c.person.name),
      experience: top((c) => model.score(c)).map((c) => ({ name: c.person.name, why: reasons(model, c, d) })),
    });
  }
}
const liveHit = (pick: (r: LiveRow) => string[]) => live.filter((r) => pick(r).includes(r.truth)).length;
const liveTop1 = (pick: (r: LiveRow) => string[]) => live.filter((r) => pick(r)[0] === r.truth).length;
const agreement = live.filter((r) => r.baseline[0] === r.smartAssign[0]).length;

// ---------- Report ----------

const report = {
  generatedAt: new Date().toISOString(),
  split: SPLIT,
  decisions: { total: history.length, evaluated: groups.length, train: train.length, test: test.length, chosenFiltered },
  avgCandidates: Math.round(test.reduce((s, g) => s + g.candidates.length, 0) / test.length),
  trainLoss: Math.round(loss * 1000) / 1000,
  weights: Object.fromEntries(FEATURES.map((f, i) => [f, Math.round(model.weights[i]! * 100) / 100])),
  results: { ...results, randomHit3 },
  live: {
    n: live.length,
    hit3: {
      smartAssign: liveHit((r) => r.smartAssign),
      baseline: liveHit((r) => r.baseline),
      experience: liveHit((r) => r.experience.map((e) => e.name)),
    },
    top1: {
      smartAssign: liveTop1((r) => r.smartAssign),
      baseline: liveTop1((r) => r.baseline),
      experience: liveTop1((r) => r.experience.map((e) => e.name)),
    },
    baselineMatchesSmartAssignTop1: agreement,
    rows: live,
  },
};
writeFileSync(REPORT, JSON.stringify({ input: IN, ...report }, null, 2));

console.log(`Decisions: ${groups.length} replayed (${chosenFiltered} skipped: chosen person not in candidate pool)`);
console.log(`Train ${train.length} before ${SPLIT}, test ${test.length} after. Avg ${report.avgCandidates} candidates per decision.\n`);
console.log('Held-out backtest           hit@1   hit@3   MRR');
console.log(`  Random                       -     ${String(randomHit3).padStart(3)}%     -`);
for (const [name, m] of Object.entries(results)) {
  console.log(`  ${name.padEnd(26)} ${String(m.hit1).padStart(3)}%   ${String(m.hit3).padStart(3)}%   ${m.mrr.toFixed(2)}`);
}
console.log('\nLearned weights (standardized):', report.weights);
if (live.length) {
  console.log(`\nLive open roles (n=${live.length}), truth in top 3 / top 1:`);
  console.log(`  Float Smart assign (real)   ${report.live.hit3.smartAssign}/${live.length}   ${report.live.top1.smartAssign}/${live.length}`);
  console.log(`  Baseline (our copy)         ${report.live.hit3.baseline}/${live.length}   ${report.live.top1.baseline}/${live.length}`);
  console.log(`  Experience model            ${report.live.hit3.experience}/${live.length}   ${report.live.top1.experience}/${live.length}`);
  console.log(`  Baseline agrees with Smart assign's #1 on ${agreement}/${live.length} roles`);
}
console.log(`\nWrote ${REPORT}`);
