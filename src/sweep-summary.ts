// Summarises out/sim-*/backtest.json into out/sweep.json and a console table,
// one block per staffing mode (experience-driven, and the title-only control).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

interface Report {
  decisions: { test: number };
  avgCandidates: number;
  weights: Record<string, number>;
  results: {
    baseline: { hit1: number; hit3: number; mrr: number };
    experience: { hit1: number; hit3: number; mrr: number };
    randomHit3: number;
  };
}

const runs = readdirSync('out')
  .map((d) => ({ d, m: d.match(/^sim-(\d+)-s(\d+)(-title)?$/) }))
  .filter(({ d, m }) => m && !d.includes('s20261017') && existsSync(`out/${d}/backtest.json`))
  .map(({ d, m }) => {
    const world = JSON.parse(readFileSync(`out/${d}/world.json`, 'utf8')) as { people: unknown[] };
    return {
      scale: Number(m![1]),
      seed: Number(m![2]),
      staffing: m![3] ? 'title' : 'experience',
      people: world.people.length,
      ...(JSON.parse(readFileSync(`out/${d}/backtest.json`, 'utf8')) as Report),
    };
  });

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const summary: Record<string, unknown[]> = {};
for (const staffing of ['experience', 'title']) {
  const mine = runs.filter((r) => r.staffing === staffing);
  if (!mine.length) continue;
  const scales = [...new Set(mine.map((r) => r.scale))].sort((a, b) => a - b);
  const rows = scales.map((scale) => {
    const rs = mine.filter((r) => r.scale === scale);
    const m = (f: (r: (typeof rs)[number]) => number) => Math.round(mean(rs.map(f)));
    const w = (name: string) => Math.round(mean(rs.map((r) => r.weights[name] ?? 0)) * 100) / 100;
    return {
      scale,
      people: m((r) => r.people),
      seeds: rs.length,
      testDecisions: m((r) => r.decisions.test),
      candidates: m((r) => r.avgCandidates),
      randomHit3: m((r) => r.results.randomHit3),
      baselineHit1: m((r) => r.results.baseline.hit1),
      experienceHit1: m((r) => r.results.experience.hit1),
      baselineHit3: m((r) => r.results.baseline.hit3),
      experienceHit3: m((r) => r.results.experience.hit3),
      historyWeights: { sameClient: w('sameClient'), tagOverlap: w('tagOverlap'), skillMatch: w('skillMatch') },
    };
  });
  summary[staffing] = rows;
  console.log(`\nStaffing: ${staffing === 'title' ? 'CONTROL (title, load and noise only)' : 'experience-driven'}`);
  console.log('people  baseline@1  experience@1  baseline@3  experience@3  sameClient weight  (seeds)');
  for (const r of rows) {
    console.log(
      `${String(r.people).padStart(6)}  ${String(r.baselineHit1).padStart(9)}%  ${String(r.experienceHit1).padStart(11)}%  ` +
        `${String(r.baselineHit3).padStart(9)}%  ${String(r.experienceHit3).padStart(11)}%  ` +
        `${String(r.historyWeights.sameClient).padStart(17)}  (${r.seeds})`,
    );
  }
}

writeFileSync('out/sweep.json', JSON.stringify({ generatedAt: new Date().toISOString(), summary, runs }, null, 2));
