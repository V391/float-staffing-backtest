// Shared by the backtest and the MCP server: turns Float data into staffing decisions,
// trains the experience model, and produces ranked, explained recommendations.
import type { Data } from './data.js';
import { FEATURES, FeatureBuilder, type Candidate, type Decision } from './features.js';
import { ExperienceModel, baselineScore, type Group } from './models.js';

// Every allocation is a staffing decision. Allocations to role placeholders are open roles.
export function buildDecisions(data: Data, today: string): Decision[] {
  const out: Decision[] = [];
  for (const a of data.allocs) {
    const project = data.projects.get(a.projectId);
    if (!project) continue;
    const open = data.placeholderIds.has(a.personId);
    if (!open && !data.personById.has(a.personId)) continue;
    const roleId =
      project.team.find((m) => m.personId === a.personId)?.roleId ?? data.personById.get(a.personId)?.roleId ?? null;
    if (roleId === null) continue;
    out.push({
      key: `${project.code}:${a.id}`,
      project,
      roleId,
      roleName: data.roleName.get(roleId) ?? '',
      start: a.start,
      end: a.end,
      hours: a.hours,
      chosenId: open ? null : a.personId,
      open,
      asOf: open ? today : project.start,
    });
  }
  return out.sort((x, y) => x.start.localeCompare(y.start));
}

export type DecisionGroup = Group & { decision: Decision };

export function toGroups(fb: FeatureBuilder, decisions: Decision[]): { groups: DecisionGroup[]; skipped: number } {
  const groups: DecisionGroup[] = [];
  let skipped = 0;
  for (const d of decisions) {
    if (d.open) continue;
    const candidates = fb.candidates(d);
    const chosen = candidates.findIndex((c) => c.person.id === d.chosenId);
    if (chosen < 0) skipped++;
    else groups.push({ candidates, chosen, decision: d });
  }
  return { groups, skipped };
}

export function reasons(model: ExperienceModel, c: Candidate, d: Decision): string[] {
  const contrib = model.contributions(c);
  return FEATURES.map((f, i) => ({ f, v: contrib[i]! }))
    .filter((r) => r.v > 0.05)
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map(({ f }) => {
      switch (f) {
        case 'titleFit':
          return c.person.roleName === d.roleName ? `is a ${c.person.roleName}` : `adjacent role (${c.person.roleName})`;
        case 'availability':
          return `${c.detail.freePct}% free over the dates`;
        case 'sameClient':
          return `${c.detail.clientProjects} past project(s) for ${d.project.clientName}`;
        case 'tagOverlap':
        case 'textSim':
          return `similar past work: ${c.detail.sharedTags.slice(0, 3).join(', ') || 'related briefs'}`;
        case 'knowsTeam':
          return `has worked with ${c.detail.teammatesKnown} of the team`;
        case 'skillMatch':
          return `skills: ${c.detail.skills.join(', ')}`;
      }
    })
    .filter((r, i, all) => all.indexOf(r) === i);
}

export interface Recommendation {
  name: string;
  role: string;
  freePct: number;
  why: string[];
}

export function recommend(
  fb: FeatureBuilder,
  model: ExperienceModel,
  d: Decision,
  k = 5,
): { experience: Recommendation[]; titleAndAvailability: string[]; pool: number } {
  const cands = fb.candidates(d);
  const experience = [...cands]
    .sort((a, b) => model.score(b) - model.score(a))
    .slice(0, k)
    .map((c) => ({ name: c.person.name, role: c.person.roleName, freePct: c.detail.freePct, why: reasons(model, c, d) }));
  const titleAndAvailability = [...cands]
    .sort((a, b) => baselineScore(b) - baselineScore(a))
    .slice(0, 3)
    .map((c) => c.person.name);
  return { experience, titleAndAvailability, pool: cands.length };
}
