import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dayTitle, SHOPS, STOP_COLUMNS, stopDone, type Day, type Stop } from "../../shared";
import { AddStopForm, StopList } from "../../stops";

export const instant = false;

/** One delivery day on its own: what the driver works from. */
export default async function DeliveryDay({ params, searchParams }: PageProps<"/deliveries/day/[dayId]">) {
  await requireStaff();
  const { dayId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(dayId)) notFound();
  const supabase = await createClient();
  const { data: day } = await supabase.from("route_days").select("id, route_id, day, note").eq("id", dayId).maybeSingle();
  if (!day) notFound();
  const [{ data: route }, { data: stopRows }, { data: siblings }, { data: places }] = await Promise.all([
    supabase.from("routes").select("direction, week_start").eq("id", day.route_id).maybeSingle(),
    supabase.from("route_stops").select(STOP_COLUMNS).eq("day_id", dayId).order("created_at"),
    supabase.from("route_days").select("id, route_id, day, note").eq("route_id", day.route_id).order("day").order("created_at"),
    supabase.from("saved_places").select("name").order("name").limit(500),
  ]);
  const stops = (stopRows ?? []) as unknown as Stop[];
  const shop = SHOPS.find((s) => s.key === route?.direction);
  const returnTo = `/deliveries/day/${dayId}`;
  const dayOptions = ((siblings ?? []) as Day[]).map((d) => ({ value: `day:${d.id}`, label: dayTitle(d) }));
  const done = stops.filter(stopDone).length;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 pb-12 sm:px-6">
      <header className="sticky top-0 z-20 -mx-4 border-b-2 border-[#FF5200] bg-[var(--background)] px-4 py-3 sm:-mx-6 sm:px-6">
        <p className="text-sm">{shop?.title ?? "Deliveries"}</p>
        <h1 className="text-xl font-semibold">{dayTitle(day as Day)}</h1>
        <p className="text-sm">
          {stops.length ? (
            <span className={done === stops.length ? "font-semibold text-green-600" : "font-semibold"}>
              {done === stops.length ? "✓ All " : ""}
              {done} of {stops.length} stops done
            </span>
          ) : (
            "No stops yet"
          )}
          {" · "}
          <Link className="underline" href={`/deliveries?week=${route?.week_start ?? ""}`}>
            Whole week
          </Link>
        </p>
      </header>
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
      <StopList stops={stops} returnTo={returnTo} dayOptions={dayOptions} />
      <AddStopForm direction={route?.direction ?? "south"} week={route?.week_start ?? ""} returnTo={returnTo} dayOptions={dayOptions} fixedDay={`day:${dayId}`} />
      <datalist id="saved-places">
        {(places ?? []).map((p) => (
          <option key={p.name} value={p.name} />
        ))}
      </datalist>
    </main>
  );
}
