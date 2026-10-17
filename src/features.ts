// Candidate features for a staffing decision, computed strictly from what was known
// when the project started (no peeking at later projects).
import { daysBetween, overlapWeekdays, weekdaysIn } from './dates.js';
import type { Data, Person, Project } from './data.js';

export const FEATURES = [
  'titleFit',
  'availability',
  'sameClient',
  'tagOverlap',
  'textSim',
  'knowsTeam',
  'skillMatch',
] as const;
export type FeatureName = (typeof FEATURES)[number];

export interface Decision {
  key: string;
  project: Project;
  roleId: number;
  roleName: string;
  start: string;
  end: string;
  hours: number;
  chosenId: number | null; // null for open roles
  open: boolean;
  asOf: string; // history cutoff
}

export interface Candidate {
  person: Person;
  x: number[]; // raw feature values, in FEATURES order
  detail: {
    clientProjects: number;
    sharedTags: string[];
    teammatesKnown: number;
    bookedHours: number;
    freePct: number;
    skills: string[];
  };
}

// ---------- Role title similarity (stand-in for Float's semantic role matching) ----------

const SENIORITY: Record<string, number> = { junior: 1, jr: 1, senior: 3, sr: 3, lead: 4, principal: 4, head: 4 };
const words = (t: string) => t.toLowerCase().split(/[^a-z]+/).filter(Boolean);
const core = (t: string) => words(t).filter((w) => !(w in SENIORITY));
// Unmarked titles ("Designer") sit between junior and senior.
const level = (t: string) => Math.max(0, ...words(t).map((w) => SENIORITY[w] ?? 0)) || 2;
const trigrams = (s: string) => {
  const t = ` ${s.toLowerCase()} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
};

export function titleFit(personRole: string, needRole: string): number {
  if (personRole === needRole) return 1;
  const a = core(personRole);
  const b = core(needRole);
  // Same job at a different level: one step apart is a related fit, junior for senior is weak.
  if (a.join(' ') === b.join(' ')) return Math.max(0.3, 0.9 - 0.25 * Math.abs(level(personRole) - level(needRole)));
  const shared = a.filter((w) => b.includes(w)).length;
  const jaccard = shared / new Set([...a, ...b]).size;
  const ta = trigrams(personRole);
  const tb = trigrams(needRole);
  const tri = [...ta].filter((g) => tb.has(g)).length / Math.sqrt(ta.size * tb.size);
  return 0.6 * jaccard + 0.25 * tri;
}

// ---------- Text vectors (TF-IDF over project notes and tags) ----------

const STOP = new Set(
  'and the for with from into new key plus our their this that across over focus project projects of to a an on in by'.split(' '),
);

export class TextIndex {
  private idf = new Map<string, number>();
  private vecs = new Map<number, Map<string, number>>();

  constructor(projects: Iterable<Project>) {
    const docs = [...projects].map((p) => [p.id, this.tokens(p)] as const);
    const df = new Map<string, number>();
    for (const [, toks] of docs) for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
    for (const [t, n] of df) this.idf.set(t, Math.log(docs.length / n));
    for (const [id, toks] of docs) {
      const v = new Map<string, number>();
      for (const t of toks) v.set(t, (v.get(t) ?? 0) + (this.idf.get(t) ?? 0));
      this.vecs.set(id, normalize(v));
    }
  }

  // Client name tokens are dropped so text similarity measures the kind of work, not the client.
  private tokens(p: Project): string[] {
    const clientWords = new Set(p.clientName.toLowerCase().split(/[^a-z0-9]+/));
    return `${p.notes} ${p.tags.join(' ')}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w) && !clientWords.has(w));
  }

  vec(projectId: number): Map<string, number> {
    return this.vecs.get(projectId) ?? new Map();
  }

  // Vector for any project, including a hypothetical one described in a request.
  vecOf(p: Project): Map<string, number> {
    const known = this.vecs.get(p.id);
    if (known) return known;
    const v = new Map<string, number>();
    for (const t of this.tokens(p)) v.set(t, (v.get(t) ?? 0) + (this.idf.get(t) ?? 0));
    return normalize(v);
  }
}

function normalize(v: Map<string, number>): Map<string, number> {
  const norm = Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)) || 1;
  return new Map([...v].map(([k, x]) => [k, x / norm]));
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [k, x] of a) dot += x * (b.get(k) ?? 0);
  return dot;
}

// ---------- Feature builder ----------

export class FeatureBuilder {
  private text: TextIndex;

  constructor(private readonly data: Data) {
    this.text = new TextIndex(data.projects.values());
  }

  // Past projects for a person: those that started before the cutoff.
  private history(personId: number, asOf: string) {
    const seen = new Set<number>();
    const out: { project: Project; weight: number }[] = [];
    for (const a of this.data.allocsByPerson.get(personId) ?? []) {
      const p = this.data.projects.get(a.projectId);
      if (!p || seen.has(p.id) || p.start >= asOf) continue;
      seen.add(p.id);
      out.push({ project: p, weight: Math.exp(-daysBetween(p.start, asOf) / 365) });
    }
    return out;
  }

  private booked(personId: number, d: Decision): number {
    const window = Math.max(1, weekdaysIn(d.start, d.end));
    let hours = 0;
    for (const a of this.data.allocsByPerson.get(personId) ?? []) {
      if (a.projectId === d.project.id) continue;
      const p = this.data.projects.get(a.projectId);
      if (!p || p.start >= d.asOf) continue; // not yet planned at decision time
      hours += (a.hours * overlapWeekdays(a.start, a.end, d.start, d.end)) / window;
    }
    return hours;
  }

  private awayFraction(personId: number, d: Decision): number {
    const window = Math.max(1, weekdaysIn(d.start, d.end));
    const away = (this.data.leaveByPerson.get(personId) ?? []).reduce(
      (s, l) => s + overlapWeekdays(l.start, l.end, d.start, d.end),
      0,
    );
    return Math.min(1, away / window);
  }

  candidates(d: Decision): Candidate[] {
    const teammates = d.project.team
      .map((m) => m.personId)
      .filter((id) => this.data.personById.has(id) && id !== d.chosenId);
    const needVec = this.text.vecOf(d.project);
    const out: Candidate[] = [];

    for (const person of this.data.people) {
      if (person.start && person.start > d.start) continue;
      if (person.end && person.end < d.end) continue;
      if (teammates.includes(person.id)) continue;
      const booked = this.booked(person.id, d);
      if (person.capacity - booked < d.hours - 1e-9) continue;

      const hist = this.history(person.id, d.asOf);
      const clientHist = hist.filter((h) => h.project.clientId !== null && h.project.clientId === d.project.clientId);
      const tagWeights = new Map<string, number>();
      const profile = new Map<string, number>();
      for (const h of hist) {
        for (const t of h.project.tags) tagWeights.set(t, (tagWeights.get(t) ?? 0) + h.weight);
        for (const [k, x] of this.text.vec(h.project.id)) profile.set(k, (profile.get(k) ?? 0) + h.weight * x);
      }
      const sharedTags = d.project.tags.filter((t) => tagWeights.has(t));
      const tagOverlap =
        d.project.tags.reduce((s, t) => s + Math.min(1, tagWeights.get(t) ?? 0), 0) / Math.max(1, d.project.tags.length);

      const knownPeople = new Set<number>();
      for (const h of hist) for (const m of h.project.team) knownPeople.add(m.personId);
      const teammatesKnown = teammates.filter((id) => knownPeople.has(id)).length;

      const skills = person.tags.filter((t) => d.project.tags.includes(t));
      const free = Math.max(0, person.capacity - booked) * (1 - this.awayFraction(person.id, d));

      out.push({
        person,
        x: [
          titleFit(person.roleName, d.roleName),
          Math.min(1, free / person.capacity),
          Math.log1p(clientHist.reduce((s, h) => s + h.weight, 0)),
          tagOverlap,
          cosine(normalize(profile), needVec),
          teammates.length ? teammatesKnown / teammates.length : 0,
          Math.min(skills.length, 3),
        ],
        detail: {
          clientProjects: clientHist.length,
          sharedTags,
          teammatesKnown,
          bookedHours: booked,
          freePct: Math.round((100 * free) / person.capacity),
          skills,
        },
      });
    }
    return out;
  }
}
