// Where the experience model and the Smart assign reconstruction agree and differ on the
// held-out decisions, and what the generator says actually drove each choice.
//
//   npx tsx src/compare.ts                                   the 54-person agency loaded into Float
//   npx tsx src/compare.ts --sweep=gumbel-experience-4       pool the 10 sweep runs at 216 people
//   ... --json=docs/agreement-results.json --label=sweep-216  write the summary under that key
//
// Same decisions, same split and same training as src/backtest.ts, so the hit rates match it.
// The generator's hidden reasons (world.json) are read only to explain outcomes, never as features.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { loadData } from './data.js';
import { buildDecisions, toGroups, type DecisionGroup } from './engine.js';
import { FEATURES, FeatureBuilder, type Candidate } from './features.js';
import { ExperienceModel, baselineScore, hitChance } from './models.js';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const SPLIT = '2026-02-01';
const TODAY = '2026-10-17';

interface WorldPerson {
  key: string;
  name: string;
  hidden: { industries: string[] };
}
interface WorldNeed {
  roleKey: string;
  personKey: string | null;
  pickedBy: string;
}
interface WorldProject {
  code: string;
  industry: string;
  phase: string;
  needs: WorldNeed[];
}
interface World {
  people: WorldPerson[];
  roles: { key: string; family: string }[];
  projects: WorldProject[];
}

// What the generator knew when it filled one need: how it picked, and who had worked with the producer.
interface NeedContext {
  pickedBy: string;
  industry: string;
  producerMates: Set<string> | null;
}

// Replays the generator's own bookkeeping (src/world.ts, staffing loop) to recover, for every filled
// need, whether the pick was "whoever is free" and who had already worked with that project's producer.
function generatorContext(world: World): Map<string, NeedContext> {
  const family = new Map(world.roles.map((r) => [r.key, r.family]));
  const workedWith = new Map<string, Set<string>>();
  const out = new Map<string, NeedContext>();
  for (const project of world.projects) {
    if (project.phase === 'future') continue;
    let producer: string | null = null;
    const onProject: string[] = [];
    for (const need of project.needs) {
      if (!need.personKey) continue;
      out.set(`${project.code}|${need.personKey}`, {
        pickedBy: need.pickedBy,
        industry: project.industry,
        producerMates: producer ? new Set(workedWith.get(producer) ?? []) : null,
      });
      onProject.push(need.personKey);
      if (!producer && family.get(need.roleKey) === 'producer') producer = need.personKey;
    }
    for (const a of onProject) {
      const set = workedWith.get(a) ?? new Set<string>();
      for (const b of onProject) if (b !== a) set.add(b);
      workedWith.set(a, set);
    }
  }
  return out;
}

type Agreement = 'same' | 'tie' | 'different';

interface Row {
  agreement: Agreement;
  base1: number;
  exp1: number;
  base3: number;
  exp3: number;
  driver: string | null; // feature that most separates the model's pick from the baseline's, when they differ
  lowerTier: boolean; // model's pick sits in a weaker role-fit tier than the baseline's
  pickedBy: string | null;
  chosenSameClient: boolean;
  chosenHiddenOnly: boolean; // chosen had a reason the model can't see (industry affinity or knows the producer)
  modelPickHiddenOnly: boolean;
  mapped: boolean;
}

const tier = (c: Candidate) => Math.floor(baselineScore(c) / 10);
const SAME_CLIENT = FEATURES.indexOf('sameClient');

function analyse(exportPath: string, worldPath: string): Row[] {
  const data = loadData(exportPath);
  const fb = new FeatureBuilder(data);
  const { groups } = toGroups(fb, buildDecisions(data, TODAY));
  const train = groups.filter((g) => g.decision.start < SPLIT);
  const test = groups.filter((g) => g.decision.start >= SPLIT);
  const model = new ExperienceModel();
  model.fit(train);

  const world = JSON.parse(readFileSync(worldPath, 'utf8')) as World;
  const ctx = generatorContext(world);
  const keyByName = new Map(world.people.map((p) => [p.name, p.key]));
  const industriesByKey = new Map(world.people.map((p) => [p.key, p.hidden.industries]));
  const hidden = (personName: string, code: string, c: NeedContext | undefined) => {
    const key = keyByName.get(personName);
    if (!key || !c) return false;
    const affinity = industriesByKey.get(key)?.includes(c.industry) ?? false;
    const knowsProducer = c.producerMates?.has(key) ?? false;
    return affinity || knowsProducer;
  };

  return test.map((g: DecisionGroup) => {
    const cands = g.candidates;
    const chosen = cands[g.chosen]!;
    const bScores = cands.map(baselineScore);
    const bMax = Math.max(...bScores);
    const bTop = cands.filter((_, i) => bScores[i] === bMax);
    const eScores = cands.map((c) => model.score(c));
    const ePick = cands[eScores.indexOf(Math.max(...eScores))]!;
    const agreement: Agreement = !bTop.includes(ePick) ? 'different' : bTop.length === 1 ? 'same' : 'tie';

    let driver: string | null = null;
    if (agreement === 'different') {
      const e = model.contributions(ePick);
      const b = bTop.map((c) => model.contributions(c));
      const gap = FEATURES.map((_, i) => e[i]! - b.reduce((s, x) => s + x[i]!, 0) / b.length);
      driver = FEATURES[gap.indexOf(Math.max(...gap))]!;
    }

    const code = g.decision.project.code;
    const chosenKey = keyByName.get(chosen.person.name);
    const c = chosenKey ? ctx.get(`${code}|${chosenKey}`) : undefined;
    const score = (c: Candidate) => baselineScore(c);
    const exp = (c: Candidate) => model.score(c);
    return {
      agreement,
      base1: hitChance(g, score, 1),
      exp1: hitChance(g, exp, 1),
      base3: hitChance(g, score, 3),
      exp3: hitChance(g, exp, 3),
      driver,
      lowerTier: agreement === 'different' && tier(ePick) < tier(bTop[0]!),
      pickedBy: c?.pickedBy ?? null,
      chosenSameClient: chosen.x[SAME_CLIENT]! > 0,
      chosenHiddenOnly: hidden(chosen.person.name, code, c),
      modelPickHiddenOnly: hidden(ePick.person.name, code, c),
      mapped: c !== undefined,
    };
  });
}

// ---------- Summary ----------

const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);
const sum = (rows: Row[], f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0);

function summarise(rows: Row[]) {
  const n = rows.length;
  const byAgreement = (['same', 'tie', 'different'] as const).map((a) => {
    const rs = rows.filter((r) => r.agreement === a);
    return {
      agreement: a,
      decisions: rs.length,
      share: pct(rs.length, n),
      firstPick: { baseline: pct(sum(rs, (r) => r.base1), rs.length), experience: pct(sum(rs, (r) => r.exp1), rs.length) },
      top3: { baseline: pct(sum(rs, (r) => r.base3), rs.length), experience: pct(sum(rs, (r) => r.exp3), rs.length) },
    };
  });

  const diff = rows.filter((r) => r.agreement === 'different');
  const drivers = FEATURES.map((f) => {
    const rs = diff.filter((r) => r.driver === f);
    return {
      feature: f,
      decisions: rs.length,
      modelRight: Math.round(sum(rs, (r) => r.exp1) * 10) / 10,
      baselineRight: Math.round(sum(rs, (r) => r.base1) * 10) / 10,
    };
  }).filter((d) => d.decisions > 0);

  // Expected first-pick misses, so a tied baseline is credited fairly.
  const missWeight = (rs: Row[], miss: (r: Row) => number, test: (r: Row) => boolean) =>
    pct(sum(rs.filter(test), miss), sum(rs, miss));
  const mapped = rows.filter((r) => r.mapped);
  const modelMiss = (r: Row) => 1 - r.exp1;
  const generator = {
    mapped: mapped.length,
    whoeverFree: pct(mapped.filter((r) => r.pickedBy === 'whoever-free').length, mapped.length),
    chosenHadClientHistory: pct(mapped.filter((r) => r.chosenSameClient).length, mapped.length),
    // Of the model's first-pick misses, the share where the person chosen was...
    modelMisses: {
      expected: Math.round(sum(mapped, modelMiss) * 10) / 10,
      whoeverFree: missWeight(mapped, modelMiss, (r) => r.pickedBy === 'whoever-free'),
      hiddenReasonModelPickLacked: missWeight(
        mapped,
        modelMiss,
        (r) => r.pickedBy !== 'whoever-free' && r.chosenHiddenOnly && !r.modelPickHiddenOnly,
      ),
    },
  };

  // Lift in points, split by case. "Same person" adds nothing to first pick by definition.
  const points = (rs: Row[], f: (r: Row) => number) => Math.round((1000 * sum(rs, f)) / n) / 10;
  const lift = (exp: (r: Row) => number, base: (r: Row) => number) => {
    const part = (a: Agreement) => points(rows.filter((r) => r.agreement === a), (r) => exp(r) - base(r));
    return { total: points(rows, (r) => exp(r) - base(r)), same: part('same'), tie: part('tie'), different: part('different') };
  };
  const byPickedBy = ['score', 'whoever-free'].map((p) => {
    const rs = mapped.filter((r) => r.pickedBy === p);
    return {
      pickedBy: p,
      decisions: rs.length,
      firstPick: { baseline: pct(sum(rs, (r) => r.base1), rs.length), experience: pct(sum(rs, (r) => r.exp1), rs.length) },
    };
  });

  return {
    decisions: n,
    lift: { firstPick: lift((r) => r.exp1, (r) => r.base1), top3: lift((r) => r.exp3, (r) => r.base3) },
    byPickedBy,
    overall: {
      firstPick: { baseline: pct(sum(rows, (r) => r.base1), n), experience: pct(sum(rows, (r) => r.exp1), n) },
      top3: { baseline: pct(sum(rows, (r) => r.base3), n), experience: pct(sum(rows, (r) => r.exp3), n) },
    },
    byAgreement,
    whenDifferent: {
      decisions: diff.length,
      modelPickFromWeakerRoleFitTier: pct(diff.filter((r) => r.lowerTier).length, diff.length),
      drivers,
    },
    generator,
  };
}

// ---------- Run ----------

const sweep = arg('sweep');
const runs: { exportPath: string; worldPath: string }[] = sweep
  ? readdirSync('out/sweep')
      .filter((d) => d.startsWith(`${sweep}-`) && existsSync(`out/sweep/${d}/world.json`))
      .map((d) => ({ exportPath: `out/sweep/${d}/float-export.json`, worldPath: `out/sweep/${d}/world.json` }))
  : [{ exportPath: arg('in') ?? 'out/float-export.json', worldPath: arg('world') ?? 'out/world.json' }];
if (!runs.length) throw new Error(`No runs found for --sweep=${sweep}`);

const summary = { runs: runs.length, ...summarise(runs.flatMap((r) => analyse(r.exportPath, r.worldPath))) };

const label = arg('label') ?? sweep ?? 'live';
const json = arg('json');
if (json) {
  const all = existsSync(json) ? (JSON.parse(readFileSync(json, 'utf8')) as Record<string, unknown>) : {};
  all[label] = summary;
  writeFileSync(json, JSON.stringify(all, null, 2) + '\n');
}

const s = summary;
console.log(`${label}: ${s.decisions} held-out decisions from ${s.runs} run(s)`);
console.log(`Overall first pick  baseline ${s.overall.firstPick.baseline}%  experience ${s.overall.firstPick.experience}%`);
console.log(`Overall top 3       baseline ${s.overall.top3.baseline}%  experience ${s.overall.top3.experience}%`);
for (const [name, l] of Object.entries(s.lift)) {
  console.log(`Lift ${name.padEnd(9)} ${l.total} points: same ${l.same}, tie ${l.tie}, different ${l.different}`);
}
for (const p of s.byPickedBy) {
  console.log(`Picked by ${p.pickedBy.padEnd(12)} ${p.decisions} decisions, first pick baseline ${p.firstPick.baseline}% experience ${p.firstPick.experience}%`);
}
console.log('');
console.log('First pick agreement   share   first pick (base / exp)   top 3 (base / exp)');
for (const a of s.byAgreement) {
  console.log(
    `  ${a.agreement.padEnd(10)} ${String(a.decisions).padStart(5)}  ${String(a.share).padStart(5)}%   ${a.firstPick.baseline}% / ${a.firstPick.experience}%   ${a.top3.baseline}% / ${a.top3.experience}%`,
  );
}
console.log(`\nWhen they differ (${s.whenDifferent.decisions}): model's pick from a weaker role-fit tier ${s.whenDifferent.modelPickFromWeakerRoleFitTier}%`);
for (const d of s.whenDifferent.drivers) {
  console.log(`  ${d.feature.padEnd(13)} ${String(d.decisions).padStart(5)} decisions  model right ${d.modelRight}  baseline right ${d.baselineRight}`);
}
const g = s.generator;
console.log(`\nGenerator (${g.mapped}/${s.decisions} mapped): whoever-free ${g.whoeverFree}%, chosen had client history ${g.chosenHadClientHistory}%`);
console.log(
  `Model first-pick misses (${g.modelMisses.expected}): whoever-free ${g.modelMisses.whoeverFree}%, hidden reason the model's pick lacked ${g.modelMisses.hiddenReasonModelPickLacked}%`,
);
