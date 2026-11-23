// Turnaround: how long a raft that arrives today should expect to wait.

/** "18 days" reads better as "about 2.5 weeks". Rounds to the nearest half week from 10 days up. */
export function describeDays(days: number): string {
  if (days <= 0) return "same day";
  if (days < 10) return `${days} ${days === 1 ? "day" : "days"}`;
  const weeks = Math.round((days / 7) * 2) / 2;
  return `about ${weeks} weeks`;
}

export interface Completed {
  received: string | null;
  servicedOn: string;
}

/**
 * The typical wait, in calendar days, from arriving to the inspection being signed off,
 * across recently completed jobs. Returns null until there are enough to be meaningful.
 */
export function measuredTurnaround(jobs: Completed[], minimum = 10): { days: number; count: number } | null {
  const waits = jobs
    .filter((j) => j.received)
    .map((j) => Math.round((Date.parse(j.servicedOn) - Date.parse(j.received!)) / 86_400_000))
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);
  if (waits.length < minimum) return null;
  const mid = Math.floor(waits.length / 2);
  const median = waits.length % 2 ? waits[mid] : Math.round((waits[mid - 1] + waits[mid]) / 2);
  return { days: median, count: waits.length };
}

export interface ShopCapacity {
  /** Rafts opened together on the floor. */
  batchSize: number;
  /** Working days to finish a batch. */
  batchDays: number;
  /** Working days after service for invoicing and return. */
  handoffDays: number;
}

/**
 * How long a raft arriving today should take to come back, in calendar days.
 * The floor works in batches: everything already waiting goes first, in full
 * batches, behind whatever batch is on the floor now. The new raft joins the
 * first batch with room, that batch is worked, then it is invoiced and returned.
 */
export function calculatedTurnaround(waiting: number, onFloor: number, shop: ShopCapacity): number {
  const batchesAhead = Math.floor(waiting / shop.batchSize) + (onFloor > 0 ? 1 : 0);
  const workingDays = batchesAhead * shop.batchDays + shop.batchDays + shop.handoffDays;
  // Five working days to a seven-day week.
  return Math.ceil((workingDays * 7) / 5);
}

const isWorkingDay = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6;
/** The date n working days after d (n = 0 gives d itself, moved forward to a working day). */
export function addWorkingDays(d: Date, n: number): Date {
  const out = new Date(d);
  while (!isWorkingDay(out)) out.setDate(out.getDate() + 1);
  for (let left = n; left > 0; ) {
    out.setDate(out.getDate() + 1);
    if (isWorkingDay(out)) left--;
  }
  return out;
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface WaitingJob {
  id: string;
  priority: string;
  received: string | null;
}

/**
 * Suggested start and due dates for the rafts waiting in a shop, filling batches in order:
 * anything not at normal priority first, then longest-waiting first. The first batch starts
 * when the batch on the floor now is finished, or on the next working day if the floor is empty.
 */
export function suggestSchedule(waiting: WaitingJob[], floorBusy: boolean, shop: ShopCapacity, today: Date): Map<string, { start: string; due: string }> {
  const order = [...waiting].sort(
    (a, b) => Number(a.priority === "normal") - Number(b.priority === "normal") || (a.received ?? "9999").localeCompare(b.received ?? "9999"),
  );
  const first = addWorkingDays(today, floorBusy ? shop.batchDays : 1);
  const out = new Map<string, { start: string; due: string }>();
  order.forEach((job, i) => {
    const start = addWorkingDays(first, Math.floor(i / Math.max(1, shop.batchSize)) * shop.batchDays);
    out.set(job.id, { start: iso(start), due: iso(addWorkingDays(start, Math.max(0, shop.batchDays - 1) + shop.handoffDays)) });
  });
  return out;
}
