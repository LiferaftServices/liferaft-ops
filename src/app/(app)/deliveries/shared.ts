export const SHOPS = [
  { key: "north", title: "Belfast Deliveries" },
  { key: "south", title: "York Deliveries" },
] as const;

export const KIND_LABELS: Record<string, string> = {
  deliver: "Deliver raft",
  pickup: "Pick up raft",
  equipment: "Deliver equipment",
  transfer: "Shop transfer",
  loaner: "Loaner",
  other: "Other",
};

export interface Item {
  id: string;
  kind: string;
  description: string;
  asset_id: string | null;
  job_id: string | null;
  done_at: string | null;
}
export interface Stop {
  id: string;
  route_id: string;
  day_id: string | null;
  position: number | null;
  title: string;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  call_ahead: string | null;
  notes: string | null;
  completed_at: string | null;
  stop_items: Item[];
}
export interface Day {
  id: string;
  route_id: string;
  day: string;
  note: string | null;
}

export const STOP_COLUMNS =
  "id, route_id, day_id, position, title, address, contact_name, contact_phone, call_ahead, notes, completed_at, created_at, stop_items(id, kind, description, asset_id, job_id, done_at, created_at)";

export const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
export const dayTitle = (d: { day: string; note: string | null }) => `${dayLabel(d.day)}${d.note ? ` - ${d.note}` : ""}`;
export const stopDone = (s: Stop) => Boolean(s.completed_at) || (s.stop_items.length > 0 && s.stop_items.every((i) => i.done_at));
/** Stops in the order they are driven: the saved order first, then the order they were added. */
export const inOrder = (stops: Stop[]) => [...stops].sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999));
