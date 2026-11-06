// Summarises out/sweep/*/backtest.json into out/sweep.json and console tables.
// "Lift from experience" is the main run's lift minus the control's lift, paired by seed,
// with a 95% confidence interval across seeds.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

interface Report {
  decisions: { test: number };
  avgCandidates: number;
  baselineTopTied: number;
  weights: Record<string, number>;
  results: {
    baseline: { hit1: number; hit3: number };
    experience: { hit1: number; hit3: number };
  };
}
type Metric = 'hit1' | 'hit3';

const runs = readdirSync('out/sweep')
  .map((d) => ({ d, m: d.match(/^(gumbel|normal)-(experience|title)-(\d+)-(\d+)$/) }))
  .filter(({ d, m }) => m && existsSync(`out/sweep/${d}/backtest.json`))
  .map(({ d, m }) => {
    const world = JSON.parse(readFileSync(`out/sweep/${d}/world.json`, 'utf8')) as { people: unknown[] };
    return {
      noise: m![1]!,
      staffing: m![2]!,
      scale: Number(m![3]),
      seed: Number(m![4]),
      people: world.people.length,
      ...(JSON.parse(readFileSync(`out/sweep/${d}/backtest.json`, 'utf8')) as Report),
    };
  });

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1));
// Student's t for 95%, two sided, by degrees of freedom.
const T: Record<number, number> = { 1: 12.71, 2: 4.3, 3: 3.18, 4: 2.78, 5: 2.57, 6: 2.45, 7: 2.36, 8: 2.31, 9: 2.26 };
const round = (x: number) => Math.round(x * 10) / 10;
function interval(xs: number[]) {
  const half = (T[xs.length - 1] ?? 2.26) * (sd(xs) / Math.sqrt(xs.length));
  return { mean: round(mean(xs)), low: round(mean(xs) - half), high: round(mean(xs) + half) };
}

function summarise(noise: string) {
  const scales = [...new Set(runs.filter((r) => r.noise === noise).map((r) => r.scale))].sort((a, b) => a - b);
  return scales.flatMap((scale) => {
    const main = runs.filter((r) => r.noise === noise && r.scale === scale && r.staffing === 'experience');
    const control = runs.filter((r) => r.noise === noise && r.scale === scale && r.staffing === 'title');
    const seeds = main.map((r) => r.seed).filter((s) => control.some((c) => c.seed === s)).sort((a, b) => a - b);
    if (seeds.length < 2) return [];
    const at = (rs: typeof runs, seed: number) => rs.find((r) => r.seed === seed)!;
    const lift = (rs: typeof runs, m: Metric) =>
      seeds.map((s) => at(rs, s).results.experience[m] - at(rs, s).results.baseline[m]);
    const block = (m: Metric) => {
      const a = lift(main, m);
      const c = lift(control, m);
      return {
        baseline: round(mean(seeds.map((s) => at(main, s).results.baseline[m]))),
        experience: round(mean(seeds.map((s) => at(main, s).results.experience[m]))),
        lift: interval(a),
        controlLift: interval(c),
        experienceLift: interval(a.map((v, i) => v - c[i]!)),
      };
    };
    return [
      {
        scale,
        people: Math.round(mean(main.map((r) => r.people))),
        seeds: seeds.length,
        testDecisions: Math.round(mean(main.map((r) => r.decisions.test))),
        candidates: Math.round(mean(main.map((r) => r.avgCandidates))),
        baselineTopTied: Math.round(mean(main.map((r) => r.baselineTopTied))),
        sameClientWeight: { main: round(mean(main.map((r) => r.weights.sameClient ?? 0)) * 10) / 10, control: round(mean(control.map((r) => r.weights.sameClient ?? 0)) * 10) / 10 },
        hit1: block('hit1'),
        hit3: block('hit3'),
      },
    ];
  });
}

const summary = { gumbel: summarise('gumbel'), normal: summarise('normal') };
for (const [noise, rows] of Object.entries(summary)) {
  for (const m of ['hit1', 'hit3'] as const) {
    if (!rows.length) continue;
    console.log(`\n${noise} noise, ${m === 'hit1' ? 'first pick' : 'top 3'}`);
    console.log('people seeds  baseline  model   lift  control  from experience (95% CI)');
    for (const r of rows) {
      const b = r[m];
      console.log(
        `${String(r.people).padStart(6)} ${String(r.seeds).padStart(5)}  ${String(b.baseline).padStart(7)}% ${String(b.experience).padStart(5)}%  ` +
          `${String(b.lift.mean).padStart(5)}  ${String(b.controlLift.mean).padStart(6)}   ${b.experienceLift.mean} (${b.experienceLift.low} to ${b.experienceLift.high})`,
      );
    }
  }
}
writeFileSync('out/sweep.json', JSON.stringify({ generatedAt: new Date().toISOString(), summary }, null, 2));
