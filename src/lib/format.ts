// Small display helpers shared by pages.

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export type DueState = "retired" | "lapsed" | "overdue" | "due_soon" | "ok" | "unknown";

/** Where an asset stands against its next service date. "Soon" means within 90 days. */
export function dueState(
  a: { next_service_due: string | null; retired: boolean; lapsed: boolean },
  today: Date = new Date(),
): DueState {
  if (a.retired) return "retired";
  if (a.lapsed) return "lapsed";
  if (!a.next_service_due) return "unknown";
  const due = new Date(`${a.next_service_due.slice(0, 10)}T00:00:00Z`).getTime();
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (due < now) return "overdue";
  return due - now <= 90 * 86_400_000 ? "due_soon" : "ok";
}

export const DUE_LABELS: Record<DueState, string> = {
  retired: "Retired",
  lapsed: "Lapsed",
  overdue: "Overdue",
  due_soon: "Due soon",
  ok: "Current",
  unknown: "No date",
};

/** Makes typed text safe to use inside a search pattern. */
export const safeTerm = (q: string) => q.replace(/[%_,()\\*"]/g, " ").trim().slice(0, 80);

/** Today's date plus a number of days, as YYYY-MM-DD. */
export function isoDay(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}
