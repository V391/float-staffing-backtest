// Unit tests for the parts of the ranking that are easy to get subtly wrong.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Data, Person, Project } from '../src/data.js';
import { FeatureBuilder, titleFit, type Candidate, type Decision } from '../src/features.js';
import { ExperienceModel, baselineScore, hitChance, rankOf } from '../src/models.js';

const candidate = (x: number[], id = 1): Candidate => ({
  person: { id, name: `p${id}`, roleId: 1, roleName: 'Designer', tags: [], start: null, end: null, capacity: 8, costRate: 50, billRate: 120 },
  x,
  detail: { clientProjects: 0, sharedTags: [], bookedHours: 0, freePct: 100, skills: [] },
});

test('titleFit: exact title beats same job at another level, which beats an unrelated title', () => {
  const exact = titleFit('Senior Designer', 'Senior Designer');
  const oneLevel = titleFit('Designer', 'Senior Designer');
  const twoLevels = titleFit('Junior Designer', 'Senior Designer');
  const unrelated = titleFit('Backend Developer', 'Senior Designer');
  assert.equal(exact, 1);
  assert.ok(oneLevel > twoLevels, 'one level apart should rank above two levels apart');
  assert.ok(twoLevels > unrelated, 'same job family should rank above an unrelated title');
  assert.ok(unrelated < 0.3, 'unrelated titles should fall below the related-role tier');
});

test('baselineScore: role fit tier dominates availability, as Smart assign documents', () => {
  const strongFitBusy = candidate([1, 0.2, 0, 0, 0, 0]);
  const weakFitFree = candidate([0.1, 1, 0, 0, 0, 0]);
  assert.ok(baselineScore(strongFitBusy) > baselineScore(weakFitFree));
});

test('rankOf: ties count half, so two equal candidates both rank 1.5', () => {
  const group = { candidates: [candidate([1, 1, 0, 0, 0, 0], 1), candidate([1, 1, 0, 0, 0, 0], 2)], chosen: 0 };
  assert.equal(rankOf(group, baselineScore), 1.5);
});

test('hitChance: a tie is broken at random, not counted as a miss', () => {
  const tied = {
    candidates: [candidate([1, 1, 0, 0, 0, 0], 1), candidate([1, 1, 0, 0, 0, 0], 2), candidate([1, 1, 0, 0, 0, 0], 3), candidate([1, 1, 0, 0, 0, 0], 4)],
    chosen: 0,
  };
  assert.equal(hitChance(tied, baselineScore, 1), 0.25);
  assert.equal(hitChance(tied, baselineScore, 3), 0.75);
  const clear = { candidates: [candidate([1, 1, 0, 0, 0, 0], 1), candidate([1, 0.5, 0, 0, 0, 0], 2)], chosen: 0 };
  assert.equal(hitChance(clear, baselineScore, 1), 1);
  assert.equal(hitChance({ ...clear, chosen: 1 }, baselineScore, 1), 0);
});

test('candidates: a replayed decision does not see the finished team, an open role does', () => {
  const person = (id: number): Person => ({ ...candidate([], id).person });
  const people = [person(1), person(2)];
  const project: Project = {
    id: 10,
    code: 'P10',
    name: 'Project',
    clientId: 1,
    clientName: 'Client',
    tags: [],
    notes: '',
    start: '2026-03-02',
    end: '2026-03-27',
    team: [{ personId: 1, roleId: 1 }, { personId: 2, roleId: 1 }],
  };
  const data = {
    people,
    personById: new Map(people.map((p) => [p.id, p])),
    projects: new Map([[project.id, project]]),
    allocsByPerson: new Map(),
    leaveByPerson: new Map(),
  } as unknown as Data;
  const decision: Decision = {
    key: 'P10:1',
    project,
    roleId: 1,
    roleName: 'Designer',
    start: project.start,
    end: project.end,
    hours: 4,
    chosenId: 1,
    open: false,
    asOf: project.start,
  };
  const fb = new FeatureBuilder(data);
  assert.deepEqual(fb.candidates(decision).map((c) => c.person.id), [1, 2]);
  assert.deepEqual(fb.candidates({ ...decision, chosenId: null, open: true }).map((c) => c.person.id), []);
});

test('ExperienceModel: learns to prefer the feature that separates chosen from unchosen', () => {
  // Chosen candidates always have sameClient = 1; everything else is identical.
  const groups = Array.from({ length: 20 }, (_, i) => ({
    candidates: [candidate([1, 1, 1, 0, 0, 0], 1), candidate([1, 1, 0, 0, 0, 0], 2), candidate([1, 1, 0, 0, 0, 0], 3)],
    chosen: 0,
    id: i,
  }));
  const model = new ExperienceModel();
  model.fit(groups, { epochs: 200 });
  const sameClientWeight = model.weights[2]!;
  assert.ok(sameClientWeight > 0.5, `expected a clearly positive sameClient weight, got ${sameClientWeight}`);
  assert.equal(rankOf(groups[0]!, (c) => model.score(c)), 1);
});
