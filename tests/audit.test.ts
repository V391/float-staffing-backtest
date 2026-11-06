// Audit checks on the evaluation itself: can the test be fooled, and does it treat both rankers alike?
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Data, Person, Project } from '../src/data.js';
import { FEATURES, FeatureBuilder, type Candidate, type Decision } from '../src/features.js';
import { ExperienceModel, baselineScore, hitChance, type Group } from '../src/models.js';

const SAME_CLIENT = FEATURES.indexOf('sameClient');

const person = (id: number): Person => ({
  id,
  name: `p${id}`,
  roleId: 1,
  roleName: 'Designer',
  tags: [],
  start: null,
  end: null,
  capacity: 8,
  costRate: 50,
  billRate: 120,
});

const project = (id: number, start: string, end: string, team: number[] = []): Project => ({
  id,
  code: `P${id}`,
  name: `Project ${id}`,
  clientId: 1,
  clientName: 'Client',
  tags: ['brand'],
  notes: 'brand campaign',
  start,
  end,
  team: team.map((personId) => ({ personId, roleId: 1 })),
});

type Alloc = { personId: number; projectId: number; start: string; end: string; hours: number };

function world(people: Person[], projects: Project[], allocs: Alloc[] = []): Data {
  const allocsByPerson = new Map<number, Alloc[]>();
  for (const a of allocs) allocsByPerson.set(a.personId, [...(allocsByPerson.get(a.personId) ?? []), a]);
  return {
    people,
    personById: new Map(people.map((p) => [p.id, p])),
    projects: new Map(projects.map((p) => [p.id, p])),
    allocsByPerson,
    leaveByPerson: new Map(),
  } as unknown as Data;
}

const replay = (p: Project, chosenId: number): Decision => ({
  key: `${p.code}:1`,
  project: p,
  roleId: 1,
  roleName: 'Designer',
  start: p.start,
  end: p.end,
  hours: 4,
  chosenId,
  open: false,
  asOf: p.start,
});

const features = (data: Data, d: Decision) =>
  new FeatureBuilder(data).candidates(d).map((c) => ({ id: c.person.id, x: c.x }));

const stub = (x: number[], id: number): Candidate => ({
  person: person(id),
  x,
  detail: { clientProjects: 0, sharedTags: [], bookedHours: 0, freePct: 100, skills: [] },
});

// Small seeded generator, so the statistical checks give the same answer on every run.
function random(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

test('scoring: however scores tie, the chance of being in the top k adds up to k across a pool', () => {
  const scores = [3, 3, 2, 2, 2, 1];
  const candidates = scores.map((s, i) => stub([s, 0, 0, 0, 0, 0], i));
  for (const k of [1, 3]) {
    const total = scores.reduce((sum, _, chosen) => sum + hitChance({ candidates, chosen }, (c) => c.x[0]!, k), 0);
    assert.ok(Math.abs(total - k) < 1e-9, `top ${k} chances sum to ${total}`);
  }
});

test('scoring: a ranker that cannot tell people apart scores at chance, not zero', () => {
  const candidates = Array.from({ length: 8 }, (_, i) => stub([1, 1, 0, 0, 0, 0], i));
  assert.equal(hitChance({ candidates, chosen: 5 }, baselineScore, 1), 1 / 8);
  assert.equal(hitChance({ candidates, chosen: 5 }, baselineScore, 3), 3 / 8);
});

test('baseline: the Smart assign reconstruction ignores every past work signal', () => {
  assert.equal(baselineScore(stub([1, 0.5, 0, 0, 0, 0], 1)), baselineScore(stub([1, 0.5, 9, 9, 9, 9], 2)));
});

test('point in time: work that starts on or after the decision date changes no signal', () => {
  const past = project(1, '2025-06-02', '2025-06-27');
  const current = project(2, '2026-03-02', '2026-03-27');
  const later = project(3, '2026-03-02', '2026-03-27');
  const people = [person(1), person(2)];
  const before: Alloc = { personId: 1, projectId: past.id, start: past.start, end: past.end, hours: 4 };
  const after: Alloc = { personId: 1, projectId: later.id, start: later.start, end: later.end, hours: 6 };
  const d = replay(current, 1);
  assert.deepEqual(
    features(world(people, [past, current, later], [before, after]), d),
    features(world(people, [past, current, later], [before]), d),
  );
});

test('point in time: a replay is identical whoever ended up on the finished team', () => {
  const people = [person(1), person(2), person(3)];
  const empty = project(1, '2026-03-02', '2026-03-27');
  const finished = { ...empty, team: [1, 2, 3].map((personId) => ({ personId, roleId: 1 })) };
  assert.deepEqual(features(world(people, [finished]), replay(finished, 1)), features(world(people, [empty]), replay(empty, 1)));
});

test('recency: recent work with a client counts for more than old work', () => {
  const recent = project(1, '2026-01-05', '2026-01-30');
  const old = project(2, '2024-03-04', '2024-03-29');
  const current = project(3, '2026-03-02', '2026-03-27');
  const allocs: Alloc[] = [
    { personId: 1, projectId: recent.id, start: recent.start, end: recent.end, hours: 4 },
    { personId: 2, projectId: old.id, start: old.start, end: old.end, hours: 4 },
  ];
  const [a, b] = features(world([person(1), person(2)], [recent, old, current], allocs), replay(current, 1));
  assert.ok(a!.x[SAME_CLIENT]! > b!.x[SAME_CLIENT]!);
});

test('control: the model gives history weight only when history really drove the choice', () => {
  const groups = (planted: boolean): Group[] => {
    const next = random(101);
    return Array.from({ length: 300 }, () => {
      const candidates = Array.from({ length: 8 }, (_, i) => stub([1, 1, next() < 0.5 ? 1 : 0, 0, 0, 0], i));
      const pool = planted ? candidates.filter((c) => c.x[SAME_CLIENT] === 1) : candidates;
      const pick = (pool.length ? pool : candidates)[Math.floor(next() * (pool.length || 8))]!;
      return { candidates, chosen: candidates.indexOf(pick) };
    });
  };
  const weight = (planted: boolean) => {
    const model = new ExperienceModel();
    model.fit(groups(planted), { epochs: 200 });
    return model.weights[SAME_CLIENT]!;
  };
  const control = weight(false);
  const main = weight(true);
  assert.ok(Math.abs(control) < 0.15, `control weight should be near zero, got ${control}`);
  assert.ok(main > 0.5, `planted weight should be clearly positive, got ${main}`);
});
