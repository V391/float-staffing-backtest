// Turns out/float-export.json (raw Float API responses) into the shapes the recommenders use.
// Nothing here reads out/world.json: the recommenders only see what Float exposes.
import { readFileSync } from 'node:fs';

export interface Person {
  id: number;
  name: string;
  roleId: number;
  roleName: string;
  tags: string[];
  start: string | null;
  end: string | null;
  capacity: number;
  costRate: number;
  billRate: number;
}

export interface Project {
  id: number;
  code: string;
  name: string;
  clientId: number | null;
  clientName: string;
  tags: string[];
  notes: string;
  start: string;
  end: string;
  team: { personId: number; roleId: number | null }[];
}

export interface Alloc {
  id: number;
  projectId: number;
  personId: number;
  start: string;
  end: string;
  hours: number;
}

export interface Leave {
  personId: number;
  start: string;
  end: string;
}

export interface Data {
  people: Person[];
  personById: Map<number, Person>;
  placeholderIds: Set<number>;
  roleName: Map<number, string>;
  projects: Map<number, Project>;
  allocs: Alloc[];
  allocsByPerson: Map<number, Alloc[]>;
  leaveByPerson: Map<number, Leave[]>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function loadData(path = 'out/float-export.json'): Data {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, any[]>;
  const roleName = new Map<number, string>(raw.roles!.map((r) => [r.id, r.name]));
  const clientName = new Map<number, string>(raw.clients!.map((c) => [c.client_id, c.name]));

  const placeholderIds = new Set<number>(raw.people!.filter((p) => p.people_type_id === 4).map((p) => p.people_id));
  const people: Person[] = raw
    .people!.filter((p) => (p.people_type_id === 1 || p.people_type_id === 2) && p.role_id)
    .map((p) => {
      const days: number[] | null = p.work_days_hours;
      const workDays = days?.filter((h) => h > 0) ?? [];
      return {
        id: p.people_id,
        name: p.name,
        roleId: p.role_id,
        roleName: roleName.get(p.role_id) ?? p.job_title ?? '',
        tags: (p.tags ?? []).map((t: any) => String(typeof t === 'string' ? t : t.name).toLowerCase()),
        start: p.start_date ?? null,
        end: p.end_date ?? null,
        capacity: workDays.length ? workDays.reduce((a, b) => a + b, 0) / workDays.length : 8,
        costRate: Number(p.cost_rate ?? p.contracts?.[0]?.cost_rate ?? 0),
        billRate: Number(p.default_hourly_rate ?? 0),
      };
    });

  const projects = new Map<number, Project>(
    raw.projects!.map((p) => [
      p.project_id,
      {
        id: p.project_id,
        code: p.project_code ?? String(p.project_id),
        name: p.name,
        clientId: p.client_id ?? null,
        clientName: clientName.get(p.client_id) ?? '',
        tags: (p.tags ?? []).map((t: string) => t.toLowerCase()),
        notes: p.notes ?? '',
        start: p.start_date,
        end: p.end_date,
        team: (p.project_team ?? []).map((m: any) => ({ personId: m.people_id, roleId: m.role_id ?? null })),
      },
    ]),
  );

  const allocs: Alloc[] = raw.tasks!.map((t) => ({
    id: t.task_id,
    projectId: t.project_id,
    personId: t.people_id,
    start: t.start_date,
    end: t.end_date,
    hours: Number(t.hours),
  }));

  const allocsByPerson = new Map<number, Alloc[]>();
  for (const a of allocs) allocsByPerson.set(a.personId, [...(allocsByPerson.get(a.personId) ?? []), a]);

  const leaveByPerson = new Map<number, Leave[]>();
  for (const t of raw.timeoffs!) {
    for (const id of t.people_ids ?? []) {
      leaveByPerson.set(id, [...(leaveByPerson.get(id) ?? []), { personId: id, start: t.start_date, end: t.end_date }]);
    }
  }

  return {
    people,
    personById: new Map(people.map((p) => [p.id, p])),
    placeholderIds,
    roleName,
    projects,
    allocs,
    allocsByPerson,
    leaveByPerson,
  };
}
