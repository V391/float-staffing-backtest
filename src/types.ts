export type Family =
  | 'visual'
  | 'ux'
  | 'motion'
  | 'frontend'
  | 'backend'
  | 'fullstack'
  | 'qa'
  | 'mobile'
  | 'strategy'
  | 'copy'
  | 'producer'
  | 'data';

export interface Role {
  key: string;
  name: string;
  family: Family;
  seniority: number;
  department: string;
  billRate: number;
  costRate: number;
}

export interface Person {
  key: string;
  code: string;
  name: string;
  roleKey: string;
  department: string;
  skills: string[];
  employeeType: 0 | 1;
  capacity: number;
  startDate: string;
  endDate: string | null;
  billRate: number;
  costRate: number;
  // Never sent to Float. The generator uses it to decide who gets staffed,
  // and the recommender has to rediscover it from staffing history.
  hidden: { industries: string[] };
}

export interface Client {
  key: string;
  name: string;
  industry: string;
}

export type PickedBy = 'score' | 'whoever-free' | 'none';

export interface Need {
  key: string;
  roleKey: string;
  hoursPerDay: number;
  start: string;
  end: string;
  // Open roles live on future projects and are loaded as Float role placeholders.
  open: boolean;
  // Person actually booked in Float (null for open roles and unfillable needs).
  personKey: string | null;
  // Who the generator's staffing process picks. Equals personKey for booked needs.
  truthPersonKey: string | null;
  pickedBy: PickedBy;
}

export interface Project {
  key: string;
  code: string;
  name: string;
  clientKey: string;
  industry: string;
  template: string;
  tags: string[];
  notes: string;
  start: string;
  end: string;
  phase: 'past' | 'ongoing' | 'future';
  budgetTotal: number;
  needs: Need[];
}

export interface TimeOff {
  key: string;
  personKey: string;
  start: string;
  end: string;
}

export interface World {
  meta: {
    seed: number;
    agency: string;
    today: string;
    windowStart: string;
    generatedAt: string;
    staffing: 'experience' | 'title';
    staffingModel: string;
  };
  departments: string[];
  roles: Role[];
  people: Person[];
  clients: Client[];
  projects: Project[];
  timeOff: TimeOff[];
}
