import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addItem, addStop, removeFromRun, toggleItem, toggleStop, updateStop } from "./actions";

export const instant = false;

const DIRECTIONS = [
  { key: "north", title: "North", note: "Belfast truck" },
  { key: "south", title: "South", note: "York truck" },
  { key: "special", title: "Vinalhaven and special trips", note: "" },
] as const;
const KIND_LABELS: Record<string, string> = {
  deliver: "Deliver raft",
  pickup: "Pick up raft",
  equipment: "Deliver equipment",
  transfer: "Shop transfer",
  loaner: "Loaner",
  other: "Other",
};
const INPUT = "block w-full rounded border border-zinc-500/60 bg-transparent px-2 py-1.5";

interface Item { id: string; kind: string; description: string; asset_id: string | null; job_id: string | null; done_at: string | null }
interface Stop {
  id: string; route_id: string; stop_date: string | null; position: number | null; title: string; address: string | null;
  contact_name: string | null; contact_phone: string | null; call_ahead: string | null; notes: string | null; completed_at: string | null;
  stop_items: Item[];
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}
const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

export default async function RunsPage({ searchParams }: PageProps<"/runs">) {
  await requireStaff();
  const sp = await searchParams;
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const asked = typeof sp.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? new Date(`${sp.week}T12:00:00`) : today;
  const monday = mondayOf(asked);
  const week = iso(monday);
  const shift = (days: number) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + days);
    return iso(d);
  };
  const days = [0, 1, 2, 3, 4, 5].map(shift);
  const raftId = typeof sp.raft === "string" && /^[0-9a-f-]{36}$/.test(sp.raft) ? sp.raft : "";

  const supabase = await createClient();
  const [{ data: routes }, { data: places }, { data: raft }] = await Promise.all([
    supabase.from("routes").select("id, direction").eq("week_start", week),
    supabase.from("saved_places").select("name").order("name").limit(500),
    raftId
      ? supabase.from("asset_overview").select("serial_number, customer_name, vessel_name").eq("id", raftId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const routeIds = (routes ?? []).map((r) => r.id);
  const { data: stopRows } = routeIds.length
    ? await supabase
        .from("route_stops")
        .select("id, route_id, stop_date, position, title, address, contact_name, contact_phone, call_ahead, notes, completed_at, stop_items(id, kind, description, asset_id, job_id, done_at, created_at)")
        .in("route_id", routeIds)
        .order("stop_date", { ascending: true, nullsFirst: false })
        .order("position", { ascending: true, nullsFirst: false })
        .order("created_at")
    : { data: [] };
  const stops = (stopRows ?? []) as unknown as Stop[];
  const hidden = (
    <>
      <input type="hidden" name="week" value={week} />
      {raftId ? <input type="hidden" name="raft" value={raftId} /> : null}
    </>
  );
  const isDone = (s: Stop) => Boolean(s.completed_at) || (s.stop_items.length > 0 && s.stop_items.every((i) => i.done_at));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-12 sm:px-6">
      <div>
        <h1 className="text-xl font-semibold">Pickup and delivery runs</h1>
        <p className="text-sm">
          Week of {dayLabel(week)}.{" "}
          <Link className="underline" href={`/runs?week=${shift(-7)}`}>
            Previous week
          </Link>{" "}
          ·{" "}
          <Link className="underline" href="/runs">
            This week
          </Link>{" "}
          ·{" "}
          <Link className="underline" href={`/runs?week=${shift(7)}`}>
            Next week
          </Link>
        </p>
        <p className="mt-1 text-sm">
          Anyone can add a stop or add to one as soon as it is known. A stop is a place; under it go the rafts and
          equipment for that place.
        </p>
      </div>
      {typeof sp.done === "string" ? (
        <p role="status" className="font-semibold">
          {sp.done}
        </p>
      ) : null}
      {typeof sp.error === "string" ? (
        <p role="alert" className="font-semibold text-red-700">
          {sp.error}
        </p>
      ) : null}
      {raft ? (
        <p className="rounded border-2 border-[#FF5200] p-3 text-sm">
          Adding raft <span className="font-semibold">{raft.serial_number}</span> ({raft.customer_name}
          {raft.vessel_name ? ` · ${raft.vessel_name}` : ""}). Open &quot;Add to this stop&quot; on the stop it belongs to, or add a new
          stop first. Its serial number is already filled in.{" "}
          <Link className="underline" href={`/runs?week=${week}`}>
            Done adding
          </Link>
        </p>
      ) : null}

      {DIRECTIONS.map((dir) => {
        const route = (routes ?? []).find((r) => r.direction === dir.key);
        const mine = stops.filter((s) => s.route_id === route?.id);
        const groups = [...new Set(mine.map((s) => s.stop_date ?? ""))];
        return (
          <section key={dir.key} className="rounded border border-zinc-500/40 p-4">
            <h2 className="text-lg font-semibold">
              {dir.title} {dir.note ? <span className="text-sm font-normal opacity-75">{dir.note}</span> : null}{" "}
              <span className="text-sm font-normal opacity-75">
                {mine.length ? `${mine.filter(isDone).length} of ${mine.length} stops done` : "no stops yet"}
              </span>
            </h2>
            {groups.map((day) => (
              <div key={day || "none"} className="mt-3">
                <h3 className="border-b border-[#FF5200] pb-1 font-semibold">{day ? dayLabel(day) : "Day not set"}</h3>
                <ul>
                  {mine
                    .filter((s) => (s.stop_date ?? "") === day)
                    .map((s) => {
                      const done = isDone(s);
                      return (
                        <li key={s.id} className={"border-b border-zinc-500/20 py-3 text-sm " + (done ? "opacity-70" : "")}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-56 flex-1">
                              <p className="text-base font-semibold">
                                {done ? <span className="mr-2 text-green-600" aria-label="Completed">✓</span> : null}
                                {s.title}
                              </p>
                              {s.address ? (
                                <a className="underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`}>
                                  {s.address}
                                </a>
                              ) : (
                                <span className="text-[#FF5200]">No address yet</span>
                              )}
                              <p>
                                {s.contact_name ? `${s.contact_name} ` : ""}
                                {s.contact_phone ? (
                                  <a className="font-semibold underline" href={`tel:${s.contact_phone.replace(/[^0-9+]/g, "")}`}>
                                    {s.contact_phone}
                                  </a>
                                ) : null}
                                {s.call_ahead ? <span className="ml-2 font-semibold text-[#FF5200]">{s.call_ahead}</span> : null}
                              </p>
                              {s.notes ? <p className="opacity-75">{s.notes}</p> : null}
                            </div>
                            <form action={toggleStop}>
                              {hidden}
                              <input type="hidden" name="stop_id" value={s.id} />
                              <input type="hidden" name="done" value={s.completed_at ? "0" : "1"} />
                              <button type="submit" className={s.completed_at ? "rounded border border-zinc-500/60 px-3 py-2" : "rounded bg-[#FF5200] px-4 py-2 font-semibold text-white"}>
                                {s.completed_at ? "Reopen stop" : "Stop complete"}
                              </button>
                            </form>
                          </div>
                          <ul className="mt-2 ml-1">
                            {s.stop_items.map((i) => (
                              <li key={i.id} className="flex flex-wrap items-center gap-2 py-1">
                                <form action={toggleItem}>
                                  {hidden}
                                  <input type="hidden" name="item_id" value={i.id} />
                                  <input type="hidden" name="done" value={i.done_at ? "0" : "1"} />
                                  <button
                                    type="submit"
                                    aria-label={i.done_at ? "Mark not done" : "Mark done"}
                                    className={"h-8 w-8 rounded border font-bold " + (i.done_at ? "border-green-600 text-green-600" : "border-zinc-500/60")}
                                  >
                                    {i.done_at ? "✓" : ""}
                                  </button>
                                </form>
                                <span className={"flex-1 " + (i.done_at ? "line-through" : "")}>
                                  <span className="font-semibold">{KIND_LABELS[i.kind] ?? i.kind}:</span> {i.description}
                                </span>
                                {i.asset_id ? (
                                  <Link className="underline" href={`/rafts/${i.asset_id}`}>
                                    Open raft
                                  </Link>
                                ) : null}
                                <form action={removeFromRun}>
                                  {hidden}
                                  <input type="hidden" name="item_id" value={i.id} />
                                  <button type="submit" className="underline opacity-75">
                                    Remove
                                  </button>
                                </form>
                              </li>
                            ))}
                          </ul>
                          <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
                            <details open={Boolean(raft)}>
                              <summary className="cursor-pointer font-semibold underline">Add to this stop</summary>
                              <form action={addItem} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
                                {hidden}
                                <input type="hidden" name="stop_id" value={s.id} />
                                <label>
                                  What
                                  <select name="kind" defaultValue="deliver" className={INPUT}>
                                    {Object.entries(KIND_LABELS).map(([k, v]) => (
                                      <option key={k} value={k}>
                                        {v}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  Raft serial (if a raft)
                                  <input name="serial" defaultValue={raft?.serial_number ?? ""} autoComplete="off" className={INPUT} />
                                </label>
                                <label className="sm:col-span-2">
                                  Description or note
                                  <input name="description" placeholder="2 immersion suits, order 23511" className={INPUT} />
                                </label>
                                <button type="submit" className="w-fit rounded bg-[#FF5200] px-3 py-1.5 font-semibold text-white">
                                  Add
                                </button>
                              </form>
                            </details>
                            <details>
                              <summary className="cursor-pointer underline">Change day or details</summary>
                              <form action={updateStop} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                                {hidden}
                                <input type="hidden" name="stop_id" value={s.id} />
                                <label>
                                  Day
                                  <select name="stop_date" defaultValue={s.stop_date ?? ""} className={INPUT}>
                                    <option value="">Not set</option>
                                    {days.map((d) => (
                                      <option key={d} value={d}>
                                        {dayLabel(d)}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  Order in the day
                                  <input name="position" inputMode="numeric" defaultValue={s.position ?? ""} className={INPUT} />
                                </label>
                                <label>
                                  Call ahead
                                  <input name="call_ahead" defaultValue={s.call_ahead ?? ""} className={INPUT} />
                                </label>
                                <label className="sm:col-span-3">
                                  Address
                                  <input name="address" defaultValue={s.address ?? ""} className={INPUT} />
                                </label>
                                <label>
                                  Contact
                                  <input name="contact_name" defaultValue={s.contact_name ?? ""} className={INPUT} />
                                </label>
                                <label>
                                  Phone
                                  <input name="contact_phone" defaultValue={s.contact_phone ?? ""} className={INPUT} />
                                </label>
                                <label className="sm:col-span-3">
                                  Notes
                                  <input name="notes" defaultValue={s.notes ?? ""} className={INPUT} />
                                </label>
                                <button type="submit" className="w-fit rounded border border-zinc-500/60 px-3 py-1.5 font-semibold">
                                  Save
                                </button>
                              </form>
                              {s.stop_items.length === 0 ? (
                                <form action={removeFromRun} className="mt-2">
                                  {hidden}
                                  <input type="hidden" name="stop_id" value={s.id} />
                                  <button type="submit" className="underline">
                                    Remove this stop
                                  </button>
                                </form>
                              ) : null}
                            </details>
                          </div>
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
            <details className="mt-3 text-sm" open={mine.length === 0 && Boolean(raft)}>
              <summary className="cursor-pointer font-semibold underline">Add a stop to {dir.title}</summary>
              <form action={addStop} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {hidden}
                <input type="hidden" name="direction" value={dir.key} />
                <label>
                  Day
                  <select name="stop_date" defaultValue="" className={INPUT}>
                    <option value="">Not set yet</option>
                    {days.map((d) => (
                      <option key={d} value={d}>
                        {dayLabel(d)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="sm:col-span-2">
                  Place (yard, dock, customer)
                  <input name="title" required list="saved-places" autoComplete="off" className={INPUT} />
                </label>
                <label className="sm:col-span-3">
                  Address (leave blank to use the one saved for this place)
                  <input name="address" className={INPUT} />
                </label>
                <label>
                  Contact
                  <input name="contact_name" className={INPUT} />
                </label>
                <label>
                  Phone
                  <input name="contact_phone" inputMode="tel" className={INPUT} />
                </label>
                <label>
                  Call ahead
                  <input name="call_ahead" placeholder="Call 30 min out" className={INPUT} />
                </label>
                <label className="sm:col-span-3">
                  Notes
                  <input name="notes" className={INPUT} />
                </label>
                <label className="flex items-center gap-2 sm:col-span-2">
                  <input type="checkbox" name="remember" defaultChecked /> Remember this place and address for next time
                </label>
                <button type="submit" className="w-fit rounded bg-[#FF5200] px-3 py-1.5 font-semibold text-white">
                  Add stop
                </button>
              </form>
            </details>
          </section>
        );
      })}
      <datalist id="saved-places">
        {(places ?? []).map((p) => (
          <option key={p.name} value={p.name} />
        ))}
      </datalist>
    </main>
  );
}
