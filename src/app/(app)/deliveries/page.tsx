import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDay, updateDay } from "./actions";
import { dayLabel, dayTitle, SHOPS, STOP_COLUMNS, stopDone, type Day, type Stop } from "./shared";
import { AddStopForm, StopList } from "./stops";

export const instant = false;

const INPUT = "block w-full rounded border border-zinc-500/60 bg-transparent px-2 py-1.5";
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

export default async function DeliveriesPage({ searchParams }: PageProps<"/deliveries">) {
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
  const dates = [0, 1, 2, 3, 4, 5, 6].map(shift);
  const raftId = typeof sp.raft === "string" && /^[0-9a-f-]{36}$/.test(sp.raft) ? sp.raft : "";
  const returnTo = `/deliveries?week=${week}${raftId ? `&raft=${raftId}` : ""}`;

  const supabase = await createClient();
  const [{ data: routes }, { data: places }, { data: raft }] = await Promise.all([
    supabase.from("routes").select("id, direction").eq("week_start", week).eq("name", "main"),
    supabase.from("saved_places").select("name").order("name").limit(500),
    raftId
      ? supabase.from("asset_overview").select("serial_number, customer_name, vessel_name").eq("id", raftId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const routeIds = (routes ?? []).map((r) => r.id);
  const [{ data: dayRows }, { data: stopRows }] = routeIds.length
    ? await Promise.all([
        supabase.from("route_days").select("id, route_id, day, note").in("route_id", routeIds).order("day").order("created_at"),
        supabase.from("route_stops").select(STOP_COLUMNS).in("route_id", routeIds).order("created_at"),
      ])
    : [{ data: [] }, { data: [] }];
  const days = (dayRows ?? []) as Day[];
  const stops = (stopRows ?? []) as unknown as Stop[];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-12 sm:px-6">
      <div>
        <h1 className="text-xl font-semibold">Deliveries</h1>
        <p className="text-sm">
          Week of {dayLabel(week)}.{" "}
          <Link className="underline" href={`/deliveries?week=${shift(-7)}`}>
            Previous week
          </Link>{" "}
          ·{" "}
          <Link className="underline" href="/deliveries">
            This week
          </Link>{" "}
          ·{" "}
          <Link className="underline" href={`/deliveries?week=${shift(7)}`}>
            Next week
          </Link>{" "}
          ·{" "}
          <Link className="underline" href={`/deliveries/calendar?month=${week.slice(0, 7)}`}>
            Calendar
          </Link>
        </p>
        <p className="mt-1 text-sm">
          Pickups and deliveries for each truck. Anyone can add a stop, or add to one, as soon as it is known.
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
          <Link className="underline" href={`/deliveries?week=${week}`}>
            Done adding
          </Link>
        </p>
      ) : null}

      {SHOPS.map((shop) => {
        const route = (routes ?? []).find((r) => r.direction === shop.key);
        const myDays = days.filter((d) => d.route_id === route?.id);
        const mine = stops.filter((s) => s.route_id === route?.id);
        const unscheduled = mine.filter((s) => !s.day_id);
        const dayOptions = [
          ...myDays.map((d) => ({ value: `day:${d.id}`, label: dayTitle(d) })),
          ...dates.filter((d) => !myDays.some((x) => x.day === d)).map((d) => ({ value: `date:${d}`, label: dayLabel(d) })),
        ].sort((a, b) => {
          const when = (o: { value: string }) => (o.value.startsWith("date:") ? o.value.slice(5) : (myDays.find((d) => `day:${d.id}` === o.value)?.day ?? ""));
          return when(a).localeCompare(when(b));
        });
        return (
          <section key={shop.key} className="rounded border border-zinc-500/40 p-4">
            <h2 className="text-lg font-semibold">
              {shop.title}{" "}
              <span className="text-sm font-normal opacity-75">
                {mine.length ? `${mine.filter(stopDone).length} of ${mine.length} stops done` : "no stops yet"}
              </span>
            </h2>
            {myDays.map((d) => {
              const dayStops = mine.filter((s) => s.day_id === d.id);
              return (
                <div key={d.id} className="mt-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#FF5200] pb-1">
                    <h3 className="font-semibold">
                      {dayTitle(d)}{" "}
                      <span className="text-sm font-normal opacity-75">
                        {dayStops.length ? `${dayStops.filter(stopDone).length} of ${dayStops.length} done` : "no stops yet"}
                      </span>
                    </h3>
                    <Link className="rounded border border-zinc-500/60 px-3 py-1 text-sm font-semibold" href={`/deliveries/day/${d.id}`}>
                      Open this day
                    </Link>
                  </div>
                  <details className="mt-1 text-sm">
                    <summary className="cursor-pointer underline">{d.note ? "Change note" : "Add a note (who is driving, which truck)"}</summary>
                    <form action={updateDay} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="return_to" value={returnTo} />
                      <input type="hidden" name="day_id" value={d.id} />
                      <label className="flex-1">
                        Note shown after the date
                        <input name="note" defaultValue={d.note ?? ""} placeholder="Dan in his own truck" className={INPUT} />
                      </label>
                      <button type="submit" className="rounded border border-zinc-500/60 px-3 py-1.5 font-semibold">
                        Save
                      </button>
                      {dayStops.length === 0 ? (
                        <button type="submit" name="remove" value="1" className="underline">
                          Remove this day
                        </button>
                      ) : null}
                    </form>
                  </details>
                  <StopList stops={dayStops} returnTo={returnTo} dayOptions={dayOptions} raftSerial={raft?.serial_number} />
                </div>
              );
            })}
            {unscheduled.length ? (
              <div className="mt-4">
                <h3 className="border-b border-[#FF5200] pb-1 font-semibold">Day not set</h3>
                <StopList stops={unscheduled} returnTo={returnTo} dayOptions={dayOptions} raftSerial={raft?.serial_number} />
              </div>
            ) : null}
            <AddStopForm direction={shop.key} week={week} returnTo={returnTo} dayOptions={dayOptions} open={mine.length === 0 && Boolean(raft)} />
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer underline">Add a day or a second truck</summary>
              <form action={addDay} className="mt-2 flex flex-wrap items-end gap-2">
                <input type="hidden" name="return_to" value={returnTo} />
                <input type="hidden" name="week" value={week} />
                <input type="hidden" name="direction" value={shop.key} />
                <label>
                  Date
                  <select name="day" className={INPUT}>
                    {dates.map((d) => (
                      <option key={d} value={d}>
                        {dayLabel(d)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex-1">
                  Note (optional)
                  <input name="note" placeholder="Tyler in van" className={INPUT} />
                </label>
                <button type="submit" className="rounded border border-zinc-500/60 px-3 py-1.5 font-semibold">
                  Add day
                </button>
              </form>
              <p className="mt-1 opacity-75">Add the same date twice, with different notes, when two trucks leave this shop on one day.</p>
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
