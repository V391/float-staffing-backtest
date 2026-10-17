// Generates a fictional 50 person agency with 18 months of staffing history.
// Output: out/world.json (everything, including hidden truth) and out/open-roles.csv
// (future roles to check against Float's Smart assign in the UI).
//
// Staffing is decided by a simple, documented process (see scoreCandidate) that
// favours client continuity, industry affinity, familiar producers and free capacity.
// The recommender never sees this process; it only sees the resulting history in Float.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Rng } from './rng.js';
import {
  addDays,
  addWeekdays,
  daysBetween,
  mondayOnOrAfter,
  overlapWeekdays,
  randomDate,
  weekIndex,
} from './dates.js';
import type { Client, Family, Need, Person, PickedBy, Project, Role, TimeOff, World } from './types.js';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const SEED = Number(arg('seed') ?? 20261017);
// --scale=N multiplies headcount, clients and projects, to simulate larger agencies offline.
const SCALE = Number(arg('scale') ?? 1);
// --staffing=title is the control: people are picked on role fit, load and noise only,
// so past work carries no signal and a fair model should gain nothing from it.
const STAFFING = arg('staffing') === 'title' ? 'title' : 'experience';
const XP = STAFFING === 'title' ? 0 : 1;
const OUT_DIR = arg('out') ?? 'out';
const AGENCY = 'Kestrel & Co';
const TODAY = '2026-10-17';
const WINDOW_START = '2025-04-07';
const HISTORY_END = '2026-10-12';
const FUTURE_FROM = '2026-10-26';
const FUTURE_TO = '2026-12-14';
const PAST_PROJECTS = Math.round(80 * SCALE);
const FUTURE_PROJECTS = Math.round(12 * SCALE);
const WHOEVER_FREE_RATE = 0.12;

const rng = new Rng(SEED);

// ---------- Roles ----------

const DEPARTMENT: Record<Family, string> = {
  visual: 'Design',
  ux: 'Design',
  motion: 'Design',
  frontend: 'Engineering',
  backend: 'Engineering',
  fullstack: 'Engineering',
  qa: 'Engineering',
  mobile: 'Engineering',
  strategy: 'Strategy',
  copy: 'Content',
  producer: 'Delivery',
  data: 'Data',
};

const ROLE_DEFS: [name: string, family: Family, seniority: number, headcount: number][] = [
  ['Junior Designer', 'visual', 1, 2],
  ['Designer', 'visual', 2, 3],
  ['Senior Designer', 'visual', 3, 3],
  ['Art Director', 'visual', 4, 2],
  ['UX Designer', 'ux', 2, 2],
  ['Senior UX Designer', 'ux', 3, 2],
  ['Product Designer', 'ux', 3, 1],
  ['Motion Designer', 'motion', 2, 2],
  ['Frontend Developer', 'frontend', 2, 4],
  ['Senior Frontend Developer', 'frontend', 3, 3],
  ['Backend Developer', 'backend', 2, 2],
  ['Senior Backend Developer', 'backend', 3, 2],
  ['Full Stack Developer', 'fullstack', 2, 3],
  ['Tech Lead', 'fullstack', 4, 2],
  ['QA Engineer', 'qa', 2, 3],
  ['Mobile Developer', 'mobile', 3, 3],
  ['Strategist', 'strategy', 2, 1],
  ['Senior Strategist', 'strategy', 3, 1],
  ['Copywriter', 'copy', 2, 3],
  ['Senior Copywriter', 'copy', 3, 1],
  ['Content Strategist', 'copy', 3, 1],
  ['Producer', 'producer', 2, 4],
  ['Senior Producer', 'producer', 3, 2],
  ['Account Director', 'producer', 4, 1],
  ['Data Analyst', 'data', 2, 1],
];

const RATES: Record<number, [bill: number, cost: number]> = {
  1: [85, 38],
  2: [120, 52],
  3: [155, 70],
  4: [195, 90],
};

const round5 = (n: number) => Math.round(n / 5) * 5;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const roles: Role[] = ROLE_DEFS.map(([name, family, seniority]) => {
  const mult = DEPARTMENT[family] === 'Engineering' ? 1.1 : family === 'data' ? 1.05 : 1;
  const [bill, cost] = RATES[seniority]!;
  return {
    key: slug(name),
    name,
    family,
    seniority,
    department: DEPARTMENT[family],
    billRate: round5(bill * mult),
    costRate: round5(cost * mult),
  };
});
const roleByName = new Map(roles.map((r) => [r.name, r]));
const roleByKey = new Map(roles.map((r) => [r.key, r]));
const role = (key: string) => roleByKey.get(key)!;

// Families that can cover for each other at a similar level.
const ADJACENT: Partial<Record<Family, Family[]>> = {
  visual: ['ux'],
  ux: ['visual'],
  frontend: ['fullstack'],
  backend: ['fullstack'],
  fullstack: ['frontend', 'backend'],
  mobile: ['frontend'],
  strategy: ['copy'],
  copy: ['strategy'],
};

// 2 = same role, 1 = same family within one level, 0.5 = adjacent family within one level, 0 = cannot do it.
function roleCompat(personRole: Role, needRole: Role): number {
  if (personRole.key === needRole.key) return 2;
  if (Math.abs(personRole.seniority - needRole.seniority) > 1) return 0;
  if (personRole.family === needRole.family) return 1;
  if (ADJACENT[needRole.family]?.includes(personRole.family)) return 0.5;
  return 0;
}

// ---------- Industries and clients ----------

const INDUSTRIES = [
  'Retail',
  'Sportswear',
  'Fintech',
  'Healthcare',
  'Travel',
  'FMCG',
  'Automotive',
  'Non-profit',
  'Media',
  'SaaS',
] as const;

// All client names are fictional.
const CLIENT_DEFS: [name: string, industry: string][] = [
  ['Harbor & Pine Home', 'Retail'],
  ['Mercato Grocers', 'Retail'],
  ['Lumen Eyewear', 'Retail'],
  ['Stride Athletics', 'Sportswear'],
  ['Northpeak Outdoor', 'Sportswear'],
  ['Volta Running', 'Sportswear'],
  ['Ledgerline', 'Fintech'],
  ['Coinwise Bank', 'Fintech'],
  ['Paysure', 'Fintech'],
  ['Meridian Health', 'Healthcare'],
  ['Kindred Clinics', 'Healthcare'],
  ['Novacare Pharmacy', 'Healthcare'],
  ['Skyline Air', 'Travel'],
  ['Wanderlust Hotels', 'Travel'],
  ['Brightleaf Foods', 'FMCG'],
  ['Oat & Honey Co', 'FMCG'],
  ['Purely Home Care', 'FMCG'],
  ['Axon Motors', 'Automotive'],
  ['Fleetline EV', 'Automotive'],
  ['Open Rivers Trust', 'Non-profit'],
  ['Bright Futures Foundation', 'Non-profit'],
  ['Signal Media Group', 'Media'],
  ['Cloudnest', 'SaaS'],
  ['Tasklane', 'SaaS'],
];

const clients: Client[] = CLIENT_DEFS.map(([name, industry]) => ({ key: slug(name), name, industry }));
// Larger simulated agencies get proportionally more clients (generic names, offline only).
for (let i = clients.length; i < Math.round(CLIENT_DEFS.length * SCALE); i++) {
  const industry = INDUSTRIES[i % INDUSTRIES.length]!;
  clients.push({ key: `client-${i + 1}`, name: `${industry} Client ${i + 1}`, industry });
}
const clientWeights = clients.map((c, i) => [c, i % 6 === 0 ? 8 : rng.int(1, 5)] as const);

// ---------- Project templates ----------

interface Template {
  key: string;
  label: string;
  weeks: [number, number];
  needs: string[][];
  tech: string[];
  blurbs: string[];
}

const TEMPLATES: Template[] = [
  {
    key: 'website',
    label: 'Website redesign',
    weeks: [8, 14],
    needs: [
      ['Senior Producer', 'Producer'],
      ['Senior UX Designer', 'UX Designer'],
      ['Senior Designer', 'Designer'],
      ['Senior Frontend Developer', 'Frontend Developer'],
      ['Frontend Developer'],
      ['Backend Developer', 'Full Stack Developer'],
      ['Copywriter'],
    ],
    tech: ['React', 'Next.js', 'Headless CMS', 'Accessibility'],
    blurbs: [
      "Redesign of {client}'s marketing site for a {industry} audience: new information architecture, CMS migration and an accessibility pass.",
      'Rebuild of the {client} website on a headless CMS, with new templates, page speed work and content migration.',
    ],
  },
  {
    key: 'ecommerce',
    label: 'Ecommerce replatform',
    weeks: [10, 16],
    needs: [
      ['Producer', 'Senior Producer'],
      ['Tech Lead'],
      ['Senior Frontend Developer'],
      ['Full Stack Developer'],
      ['Backend Developer', 'Senior Backend Developer'],
      ['UX Designer', 'Senior UX Designer'],
      ['QA Engineer'],
    ],
    tech: ['Shopify', 'React', 'Payments', 'APIs'],
    blurbs: [
      'Move {client} from a legacy storefront to Shopify Plus: checkout redesign, product listing pages and payments integration.',
      'Headless commerce build for {client}, covering catalogue, basket and checkout, with ERP and payments APIs.',
    ],
  },
  {
    key: 'brand',
    label: 'Brand refresh',
    weeks: [6, 10],
    needs: [
      ['Senior Strategist', 'Strategist'],
      ['Art Director'],
      ['Designer', 'Senior Designer'],
      ['Senior Copywriter', 'Copywriter'],
      ['Producer'],
    ],
    tech: ['Brand identity', 'Brand strategy', 'Brand voice'],
    blurbs: [
      'Brand refresh for {client}: positioning workshops, new visual identity and tone of voice guidelines.',
      'Evolve the {client} brand for a new {industry} segment: strategy, identity system and launch toolkit.',
    ],
  },
  {
    key: 'campaign',
    label: 'Integrated campaign',
    weeks: [4, 8],
    needs: [
      ['Account Director', 'Producer'],
      ['Art Director', 'Senior Designer'],
      ['Copywriter', 'Senior Copywriter'],
      ['Motion Designer'],
      ['Designer', 'Junior Designer'],
    ],
    tech: ['Campaign copy', 'After Effects', 'Art direction'],
    blurbs: [
      'Seasonal campaign for {client}: hero film, social cutdowns, out of home and paid social assets.',
      '{client} product launch campaign across video, social and in store, with a motion toolkit.',
    ],
  },
  {
    key: 'app',
    label: 'Mobile app MVP',
    weeks: [12, 16],
    needs: [
      ['Senior Producer'],
      ['Product Designer', 'Senior UX Designer'],
      ['Mobile Developer'],
      ['Mobile Developer'],
      ['Senior Backend Developer', 'Backend Developer'],
      ['QA Engineer'],
    ],
    tech: ['React Native', 'iOS', 'APIs', 'Prototyping'],
    blurbs: [
      'Design and build the first release of the {client} app in React Native, from prototype to App Store.',
      'MVP mobile app for {client} customers: onboarding, account area and notifications, backed by a new API.',
    ],
  },
  {
    key: 'content',
    label: 'Content programme',
    weeks: [8, 12],
    needs: [['Content Strategist'], ['Copywriter'], ['Designer', 'Junior Designer'], ['Producer']],
    tech: ['SEO', 'UX writing', 'Brand voice'],
    blurbs: [
      'Ongoing content programme for {client}: editorial calendar, SEO articles and email newsletters.',
      'Content audit and rewrite of key {client} journeys, plus a monthly article series for a {industry} audience.',
    ],
  },
  {
    key: 'analytics',
    label: 'Analytics dashboard',
    weeks: [6, 8],
    needs: [['Data Analyst'], ['Full Stack Developer'], ['UX Designer'], ['Producer']],
    tech: ['Analytics', 'SQL', 'Looker Studio', 'React'],
    blurbs: [
      'Customer analytics dashboard for the {client} team: GA4 and CRM data, KPIs and a self serve reporting view.',
      'Measurement plan and live performance dashboard for {client} marketing.',
    ],
  },
  {
    key: 'designsystem',
    label: 'Design system',
    weeks: [8, 12],
    needs: [
      ['Senior UX Designer', 'Product Designer'],
      ['Product Designer', 'UX Designer'],
      ['Senior Frontend Developer'],
      ['Frontend Developer'],
      ['Producer'],
    ],
    tech: ['Design systems', 'Figma', 'React', 'Accessibility'],
    blurbs: [
      'Shared design system for {client} products: Figma library, React components and documentation site.',
      'Consolidate {client} UI into one accessible component library used across web and app.',
    ],
  },
];
const templateByKey = new Map(TEMPLATES.map((t) => [t.key, t]));

const INDUSTRY_TEMPLATES: Record<string, [string, number][]> = {
  Retail: [['ecommerce', 3], ['campaign', 2], ['website', 2], ['content', 1]],
  Sportswear: [['ecommerce', 3], ['campaign', 3], ['brand', 1], ['app', 1]],
  Fintech: [['app', 3], ['website', 2], ['designsystem', 2], ['analytics', 1]],
  Healthcare: [['website', 3], ['content', 2], ['app', 1], ['designsystem', 1]],
  Travel: [['website', 2], ['app', 2], ['campaign', 2], ['ecommerce', 1]],
  FMCG: [['campaign', 3], ['brand', 2], ['content', 2], ['website', 1]],
  Automotive: [['website', 2], ['campaign', 2], ['app', 1], ['analytics', 1]],
  'Non-profit': [['website', 2], ['content', 2], ['brand', 2]],
  Media: [['content', 3], ['website', 2], ['analytics', 1]],
  SaaS: [['designsystem', 2], ['website', 2], ['analytics', 2], ['app', 1]],
};

// ---------- People ----------

const SKILLS: Record<Family, string[]> = {
  visual: ['Figma', 'Brand identity', 'Illustration', 'Packaging', 'Art direction', 'Photoshop'],
  ux: ['Figma', 'User research', 'Prototyping', 'Accessibility', 'Design systems', 'Usability testing'],
  motion: ['After Effects', 'Lottie', '3D', 'Video editing'],
  frontend: ['React', 'Next.js', 'TypeScript', 'Shopify', 'Webflow', 'Accessibility', 'Vue'],
  backend: ['Node.js', 'Python', 'PostgreSQL', 'APIs', 'AWS', 'Payments'],
  fullstack: ['React', 'Node.js', 'TypeScript', 'Shopify', 'Headless CMS', 'APIs'],
  qa: ['Test automation', 'Cypress', 'Accessibility'],
  mobile: ['React Native', 'iOS', 'Android'],
  strategy: ['Brand strategy', 'Research', 'Workshops', 'CX strategy'],
  copy: ['UX writing', 'Brand voice', 'SEO', 'Campaign copy'],
  producer: ['Agile', 'Budgeting', 'Client management', 'Jira'],
  data: ['Analytics', 'GA4', 'Looker Studio', 'SQL'],
};

const FIRST = [
  'Priya', 'Tom', 'Sara', 'Diego', 'Mei', 'Kwame', 'Lena', 'Arjun', 'Chloe', 'Mateo', 'Aisha', 'Jonas',
  'Hana', 'Omar', 'Freya', 'Luca', 'Nia', 'Ravi', 'Elif', 'Sam', 'Ines', 'Kofi', 'Yuki', 'Marta', 'Ben',
  'Zara', 'Pablo', 'Ana', 'Theo', 'Leila', 'Felix', 'Amara', 'Noah', 'Ingrid', 'Tariq', 'Sofia', 'Ethan',
  'Maya', 'Rafael', 'Jun', 'Clara', 'Malik', 'Isla', 'Viktor', 'Rosa', 'Dev', 'Alba', 'Kai', 'Nadia',
  'Oscar', 'Grace', 'Emeka', 'Lucia', 'Hugo', 'Anya', 'Sanjay', 'Bea', 'Tomas', 'Ola', 'Rhys',
];
const LAST = [
  'Patel', 'Okafor', 'Lindqvist', 'Moreno', 'Chen', 'Mensah', 'Fischer', 'Rao', 'Dubois', 'Silva', 'Khan',
  'Berg', 'Tanaka', 'Haddad', 'Nielsen', 'Romano', 'Adeyemi', 'Iyer', 'Yilmaz', 'Walsh', 'Costa', 'Asante',
  'Sato', 'Novak', 'Hughes', 'Ahmed', 'Garcia', 'Kowalski', 'Laurent', 'Nasser', 'Wagner', 'Obi', 'Brooks',
  'Larsen', 'Aziz', 'Rossi', 'Murphy', 'Reyes', 'Kim', 'Bauer', 'Diallo', 'Sharma', 'Evans', 'Petrov',
  'Santos', 'Mehta', 'Ferreira', 'Lee', 'Ibrahim', 'Andersen',
];

const usedNames = new Set<string>();
function uniqueName(): string {
  for (;;) {
    const name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
  }
}

const people: Person[] = [];
for (const [roleName, family, , baseHeadcount] of ROLE_DEFS) {
  const r = roleByName.get(roleName)!;
  const headcount = Math.max(1, Math.round(baseHeadcount * SCALE));
  for (let i = 0; i < headcount; i++) {
    const n = people.length + 1;
    const skills = rng.sample(SKILLS[family], rng.int(2, Math.min(4, SKILLS[family].length)));
    const adjacent = ADJACENT[family];
    if (adjacent && rng.chance(0.3)) {
      const extra = rng.pick(SKILLS[rng.pick(adjacent)]);
      if (!skills.includes(extra)) skills.push(extra);
    }
    const industries = rng.sample(INDUSTRIES, rng.chance(0.6) ? 2 : 1);
    const partTime = rng.chance(0.1);
    const joinsDuringWindow = rng.chance(0.14);
    people.push({
      key: `p${String(n).padStart(3, '0')}`,
      code: `KST-${String(n).padStart(3, '0')}`,
      name: uniqueName(),
      roleKey: r.key,
      department: r.department,
      skills,
      employeeType: partTime ? 0 : 1,
      capacity: partTime ? 5 : 8,
      startDate: joinsDuringWindow
        ? mondayOnOrAfter(randomDate(() => rng.next(), '2025-05-01', '2026-06-30'))
        : randomDate(() => rng.next(), '2019-01-07', '2024-12-20'),
      endDate: null,
      billRate: r.billRate,
      costRate: round5(r.costRate * (0.9 + rng.next() * 0.2)),
      hidden: { industries },
    });
  }
}

// A few people leave during the window (only from roles with backup).
const headcountByRole = new Map(ROLE_DEFS.map(([name, , , h]) => [slug(name), Math.round(h * SCALE)]));
for (const p of rng.sample(
  people.filter((x) => (headcountByRole.get(x.roleKey) ?? 0) >= 3 && x.startDate < '2025-01-01'),
  Math.round(4 * SCALE),
)) {
  p.endDate = randomDate(() => rng.next(), '2025-09-01', '2026-08-31');
}

// ---------- Time off ----------

const timeOff: TimeOff[] = [];
for (const p of people) {
  const blocks = rng.int(1, 3);
  for (let b = 0; b < blocks; b++) {
    const start = mondayOnOrAfter(randomDate(() => rng.next(), WINDOW_START, '2026-12-14'));
    timeOff.push({ key: `t${timeOff.length + 1}`, personKey: p.key, start, end: addWeekdays(start, rng.int(3, 10)) });
  }
  if (rng.chance(0.4)) {
    timeOff.push({ key: `t${timeOff.length + 1}`, personKey: p.key, start: '2025-12-22', end: '2026-01-02' });
  }
}
const timeOffByPerson = new Map<string, TimeOff[]>();
for (const t of timeOff) timeOffByPerson.set(t.personKey, [...(timeOffByPerson.get(t.personKey) ?? []), t]);

// ---------- Projects ----------

function hoursFor(r: Role): number {
  if (r.family === 'producer') return rng.int(2, 3);
  if (r.family === 'qa') return rng.int(3, 4);
  if (r.family === 'strategy') return rng.int(3, 5);
  return rng.int(3, 6);
}

const projectNames = new Map<string, number>();
const projects: Project[] = [];

function makeProject(startFrom: string, startTo: string): Project {
  const client = rng.weighted(clientWeights);
  const template = templateByKey.get(rng.weighted(INDUSTRY_TEMPLATES[client.industry]!))!;
  const weeks = rng.int(...template.weeks);
  const start = mondayOnOrAfter(randomDate(() => rng.next(), startFrom, startTo));
  const end = addDays(start, weeks * 7 - 3);
  const baseName = `${client.name} ${template.label}`;
  const seen = (projectNames.get(baseName) ?? 0) + 1;
  projectNames.set(baseName, seen);
  const n = projects.length + 1;
  const code = `KST-P${String(n).padStart(3, '0')}`;
  const tech = rng.sample(template.tech, rng.int(2, template.tech.length));

  // Producer-type roles first so the rest of the team can be picked around them.
  const slots = [...template.needs].sort((a, b) => {
    const fa = roleByName.get(a[0]!)!.family === 'producer' ? 0 : 1;
    const fb = roleByName.get(b[0]!)!.family === 'producer' ? 0 : 1;
    return fa - fb;
  });
  const needs: Need[] = slots.map((options, i) => {
    const r = roleByName.get(rng.pick(options))!;
    return {
      key: `${code}-N${i + 1}`,
      roleKey: r.key,
      hoursPerDay: hoursFor(r),
      start,
      end,
      open: false,
      personKey: null,
      truthPersonKey: null,
      pickedBy: 'none' as PickedBy,
    };
  });
  const budgetTotal = Math.round(
    needs.reduce((sum, nd) => sum + nd.hoursPerDay * weeks * 5 * role(nd.roleKey).billRate, 0) * 0.95,
  );

  return {
    key: code,
    code,
    name: seen > 1 ? `${baseName} ${['', '', 'II', 'III', 'IV', 'V'][seen] ?? seen}`.trim() : baseName,
    clientKey: client.key,
    industry: client.industry,
    template: template.key,
    tags: [client.industry.toLowerCase(), template.key, ...tech.map((t) => t.toLowerCase())],
    notes: `${rng.pick(template.blurbs).replace('{client}', client.name).replace('{industry}', client.industry.toLowerCase())} Focus: ${tech.join(', ')}.`,
    start,
    end,
    phase: end < TODAY ? 'past' : start <= TODAY ? 'ongoing' : 'future',
    budgetTotal,
    needs,
  };
}

for (let i = 0; i < PAST_PROJECTS; i++) projects.push(makeProject(WINDOW_START, HISTORY_END));
for (let i = 0; i < FUTURE_PROJECTS; i++) projects.push(makeProject(FUTURE_FROM, FUTURE_TO));
projects.sort((a, b) => (a.start === b.start ? a.code.localeCompare(b.code) : a.start.localeCompare(b.start)));

// ---------- Staffing (the hidden process) ----------

const load = new Map<string, Map<number, number>>(); // person -> week -> booked hours per day
const clientCount = new Map<string, Map<string, number>>();
const industryCount = new Map<string, Map<string, number>>();
const workedWith = new Map<string, Set<string>>();
const bump = (m: Map<string, Map<string, number>>, a: string, b: string) => {
  const inner = m.get(a) ?? new Map<string, number>();
  inner.set(b, (inner.get(b) ?? 0) + 1);
  m.set(a, inner);
};

function weeksOf(need: Need): number[] {
  const out: number[] = [];
  for (let w = weekIndex(WINDOW_START, need.start); w <= weekIndex(WINDOW_START, need.end); w++) out.push(w);
  return out;
}

function eligible(p: Person, need: Need, onProject: Set<string>): boolean {
  if (onProject.has(p.key)) return false;
  if (p.startDate > need.start) return false;
  if (p.endDate && p.endDate < need.end) return false;
  if (roleCompat(role(p.roleKey), role(need.roleKey)) === 0) return false;
  const away = (timeOffByPerson.get(p.key) ?? []).reduce(
    (sum, t) => sum + overlapWeekdays(t.start, t.end, need.start, need.end),
    0,
  );
  // Managers work around short leave, but not someone away for a big chunk of the project.
  if (away > Math.max(10, 0.3 * overlapWeekdays(need.start, need.end, need.start, need.end))) return false;
  const booked = load.get(p.key);
  return weeksOf(need).every((w) => (booked?.get(w) ?? 0) + need.hoursPerDay <= p.capacity);
}

function loadFraction(p: Person, need: Need): number {
  const booked = load.get(p.key);
  const weeks = weeksOf(need);
  return weeks.reduce((sum, w) => sum + (booked?.get(w) ?? 0), 0) / (weeks.length * p.capacity);
}

function scoreCandidate(p: Person, need: Need, project: Project, producer: string | null): number {
  const compat = roleCompat(role(p.roleKey), role(need.roleKey));
  const sameClient = Math.min(clientCount.get(p.key)?.get(project.clientKey) ?? 0, 2) / 2;
  const affinity = p.hidden.industries.includes(project.industry) ? 1 : 0;
  const industryXp = Math.min(industryCount.get(p.key)?.get(project.industry) ?? 0, 3) / 3;
  const knowsProducer = producer && workedWith.get(p.key)?.has(producer) ? 1 : 0;
  const skillHits = Math.min(p.skills.filter((s) => project.tags.includes(s.toLowerCase())).length, 2);
  return (
    1.5 * compat +
    XP * (2.2 * sameClient + 1.6 * affinity + 0.9 * industryXp + 1.0 * knowsProducer + 0.5 * skillHits) -
    1.2 * loadFraction(p, need) +
    1.0 * rng.gumbel()
  );
}

function choose(need: Need, project: Project, onProject: Set<string>, producer: string | null) {
  const pool = people.filter((p) => eligible(p, need, onProject));
  if (pool.length === 0) return { person: null, pickedBy: 'none' as PickedBy };
  if (rng.chance(WHOEVER_FREE_RATE)) {
    const exact = pool.filter((p) => p.roleKey === need.roleKey);
    const from = exact.length ? exact : pool;
    const person = [...from].sort((a, b) => loadFraction(a, need) - loadFraction(b, need) || rng.next() - 0.5)[0]!;
    return { person, pickedBy: 'whoever-free' as PickedBy };
  }
  let best: Person | null = null;
  let bestScore = -Infinity;
  for (const p of pool) {
    const s = scoreCandidate(p, need, project, producer);
    if (s > bestScore) [best, bestScore] = [p, s];
  }
  return { person: best, pickedBy: 'score' as PickedBy };
}

for (const project of projects) {
  const onProject = new Set<string>();
  let producer: string | null = null;
  for (const need of project.needs) {
    const { person, pickedBy } = choose(need, project, onProject, producer);
    need.truthPersonKey = person?.key ?? null;
    need.pickedBy = pickedBy;
    if (project.phase === 'future') {
      // Open role: loaded into Float as a placeholder. Truth is kept for evaluation only
      // and does not book capacity, so every open role is judged against real bookings.
      need.open = true;
      continue;
    }
    if (!person) continue;
    need.personKey = person.key;
    onProject.add(person.key);
    if (!producer && role(need.roleKey).family === 'producer') producer = person.key;
    const booked = load.get(person.key) ?? new Map<number, number>();
    for (const w of weeksOf(need)) booked.set(w, (booked.get(w) ?? 0) + need.hoursPerDay);
    load.set(person.key, booked);
  }
  for (const a of onProject) {
    bump(clientCount, a, project.clientKey);
    bump(industryCount, a, project.industry);
    const set = workedWith.get(a) ?? new Set<string>();
    for (const b of onProject) if (b !== a) set.add(b);
    workedWith.set(a, set);
  }
}

// ---------- Output ----------

const world: World = {
  meta: {
    seed: SEED,
    agency: AGENCY,
    today: TODAY,
    windowStart: WINDOW_START,
    generatedAt: new Date().toISOString(),
    staffing: STAFFING,
    staffingModel:
      'Each role is filled by the best scoring eligible person: role fit (1.5), same client before (2.2), hidden industry affinity (1.6), industry experience (0.9), worked with the producer (1.0), skill tags matching project tags (0.5 each, max 2), minus current load (1.2), plus Gumbel noise (1.0). 12% of roles go to whoever is least loaded instead. Eligible means compatible role, employed for the whole project, not away for more than 10 weekdays or 30% of the project, and enough weekly capacity.',
  },
  departments: [...new Set(roles.map((r) => r.department))],
  roles,
  people,
  clients,
  projects,
  timeOff,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/world.json`, JSON.stringify(world, null, 2));

const peopleByKey = new Map(people.map((p) => [p.key, p]));
const clientByKey = new Map(clients.map((c) => [c.key, c]));
const csv = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
const openRows = projects
  .filter((p) => p.phase === 'future')
  .flatMap((p) =>
    p.needs.map((n) =>
      [
        n.key,
        p.code,
        p.name,
        clientByKey.get(p.clientKey)!.name,
        role(n.roleKey).name,
        n.start,
        n.end,
        n.hoursPerDay,
        '',
        '',
      ]
        .map(csv)
        .join(','),
    ),
  );
writeFileSync(
  `${OUT_DIR}/open-roles.csv`,
  [
    'need_key,project_code,project,client,role,start,end,hours_per_day,smart_assign_pick,smart_assign_fit',
    ...openRows,
  ].join('\n') + '\n',
);

// ---------- Summary ----------

const booked = projects.filter((p) => p.phase !== 'future').flatMap((p) => p.needs);
const filled = booked.filter((n) => n.personKey);
const exactFits = filled.filter((n) => peopleByKey.get(n.personKey!)!.roleKey === n.roleKey).length;
const openNeeds = projects.filter((p) => p.phase === 'future').flatMap((p) => p.needs);
const totalCapacity = people.reduce((s, p) => {
  const from = p.startDate > WINDOW_START ? p.startDate : WINDOW_START;
  const to = p.endDate && p.endDate < HISTORY_END ? p.endDate : HISTORY_END;
  return s + Math.max(0, daysBetween(from, to) / 7) * p.capacity;
}, 0);
const totalBooked = filled.reduce((s, n) => s + n.hoursPerDay * ((daysBetween(n.start, n.end) + 3) / 7), 0);

console.log(`${AGENCY} (seed ${SEED})`);
console.log(`  people            ${people.length} (${people.filter((p) => p.endDate).length} leave, ${people.filter((p) => p.startDate > WINDOW_START).length} join during window)`);
console.log(`  roles             ${roles.length}`);
console.log(`  clients           ${clients.length}`);
console.log(`  projects          ${projects.filter((p) => p.phase === 'past').length} past, ${projects.filter((p) => p.phase === 'ongoing').length} ongoing, ${projects.filter((p) => p.phase === 'future').length} future`);
console.log(`  staffing history  ${filled.length} allocations (${booked.length - filled.length} roles unfillable and skipped)`);
console.log(`  exact role fits   ${Math.round((100 * exactFits) / filled.length)}% (rest filled by adjacent roles)`);
console.log(`  whoever-free      ${Math.round((100 * filled.filter((n) => n.pickedBy === 'whoever-free').length) / filled.length)}%`);
console.log(`  open roles        ${openNeeds.length} on future projects (${openNeeds.filter((n) => n.truthPersonKey).length} with a truth pick)`);
console.log(`  time off blocks   ${timeOff.length}`);
console.log(`  utilization       ~${Math.round((100 * totalBooked) / totalCapacity)}% of capacity across the window`);
console.log(`Wrote ${OUT_DIR}/world.json and ${OUT_DIR}/open-roles.csv`);
