// All dates are YYYY-MM-DD strings in UTC.
const DAY = 86_400_000;

export const parse = (s: string): number => Date.parse(`${s}T00:00:00Z`);
export const fmt = (t: number): string => new Date(t).toISOString().slice(0, 10);
export const addDays = (s: string, n: number): string => fmt(parse(s) + n * DAY);
export const daysBetween = (a: string, b: string): number => Math.round((parse(b) - parse(a)) / DAY);
export const dayOfWeek = (s: string): number => new Date(parse(s)).getUTCDay();

export function mondayOnOrAfter(s: string): string {
  return addDays(s, (8 - dayOfWeek(s)) % 7);
}

export function isWeekday(s: string): boolean {
  const d = dayOfWeek(s);
  return d !== 0 && d !== 6;
}

export function weekdaysIn(start: string, end: string): number {
  let count = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (isWeekday(d)) count++;
  return count;
}

export function overlapWeekdays(a1: string, b1: string, a2: string, b2: string): number {
  const start = a1 > a2 ? a1 : a2;
  const end = b1 < b2 ? b1 : b2;
  return start > end ? 0 : weekdaysIn(start, end);
}

// End date after `weekdays` working days, starting on `start` (inclusive).
export function addWeekdays(start: string, weekdays: number): string {
  let d = start;
  let left = weekdays - (isWeekday(d) ? 1 : 0);
  while (left > 0) {
    d = addDays(d, 1);
    if (isWeekday(d)) left--;
  }
  return d;
}

export const weekIndex = (origin: string, s: string): number => Math.floor(daysBetween(origin, s) / 7);

export function randomDate(rand: () => number, from: string, to: string): string {
  return addDays(from, Math.floor(rand() * (daysBetween(from, to) + 1)));
}
