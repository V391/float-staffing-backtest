// Unit tests for the parts of the ranking that are easy to get subtly wrong.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { titleFit, type Candidate } from '../src/features.js';
import { ExperienceModel, baselineScore, rankOf } from '../src/models.js';

const candidate = (x: number[], id = 1): Candidate => ({
  person: { id, name: `p${id}`, roleId: 1, roleName: 'Designer', tags: [], start: null, end: null, capacity: 8, costRate: 50, billRate: 120 },
  x,
  detail: { clientProjects: 0, sharedTags: [], teammatesKnown: 0, bookedHours: 0, freePct: 100, skills: [] },
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
  const strongFitBusy = candidate([1, 0.2, 0, 0, 0, 0, 0]);
  const weakFitFree = candidate([0.1, 1, 0, 0, 0, 0, 0]);
  assert.ok(baselineScore(strongFitBusy) > baselineScore(weakFitFree));
});

test('rankOf: ties count half, so two equal candidates both rank 1.5', () => {
  const group = { candidates: [candidate([1, 1, 0, 0, 0, 0, 0], 1), candidate([1, 1, 0, 0, 0, 0, 0], 2)], chosen: 0 };
  assert.equal(rankOf(group, baselineScore), 1.5);
});

test('ExperienceModel: learns to prefer the feature that separates chosen from unchosen', () => {
  // Chosen candidates always have sameClient = 1; everything else is identical.
  const groups = Array.from({ length: 20 }, (_, i) => ({
    candidates: [candidate([1, 1, 1, 0, 0, 0, 0], 1), candidate([1, 1, 0, 0, 0, 0, 0], 2), candidate([1, 1, 0, 0, 0, 0, 0], 3)],
    chosen: 0,
    id: i,
  }));
  const model = new ExperienceModel();
  model.fit(groups, { epochs: 200 });
  const sameClientWeight = model.weights[2]!;
  assert.ok(sameClientWeight > 0.5, `expected a clearly positive sameClient weight, got ${sameClientWeight}`);
  assert.equal(rankOf(groups[0]!, (c) => model.score(c)), 1);
});
