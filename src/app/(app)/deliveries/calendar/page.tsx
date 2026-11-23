import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A month at a glance: how many stops each truck has on each day. A day opens its week. */
export default async function DeliveriesCalendar({ searchParams }: PageProps<"/deliveries/calendar">) {
  await requireStaff();
  const sp = await searchParams;
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const asked = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? new Date(`${sp.month}-01T12:00:00`) : today;
  const first = new Date(asked.getFullYear(), asked.getMonth(), 1);
  const start = new Date(first);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // back to Monday
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const end = new Date(last);
  end.setDate(end.getDate() + ((7 - end.getDay()) % 7)); // forward to Sunday
  const cells: Date[] = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) cells.push(new Date(d));
  const month = (offset: number) => {
    const d = new Date(first.getFullYear(), first.getMonth() + offset, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };

  const supabase = await createClient();
  const { data } = await supabase
    .from("route_stops")
    .select("stop_date, completed_at, routes(direction)")
    .gte("stop_date", iso(start))
    .lte("stop_date", iso(end))
    .limit(5000);
  const counts = new Map<string, { york: number; belfast: number; open: number }>();
  for (const s of (data ?? []) as unknown as { stop_date: string; completed_at: string | null; routes: { direction: string } | null }[]) {
    const c = counts.get(s.stop_date) ?? { york: 0, belfast: 0, open: 0 };
    if (s.routes?.direction === "north") c.belfast++;
    else c.york++;
    if (!s.completed_at) c.open++;
    counts.set(s.stop_date, c);
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 pb-12 sm:px-6">
      <div>
        <h1 className="text-xl font-semibold">
          Deliveries: {first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </h1>
        <p className="text-sm">
          <Link className="underline" href={`/deliveries/calendar?month=${month(-1)}`}>
            Previous month
          </Link>{" "}
          ·{" "}
          <Link className="underline" href="/deliveries/calendar">
            This month
          </Link>{" "}
          ·{" "}
          <Link className="underline" href={`/deliveries/calendar?month=${month(1)}`}>
            Next month
          </Link>{" "}
          ·{" "}
          <Link className="underline" href="/deliveries">
            Week view
          </Link>
        </p>
        <p className="mt-1 text-sm">The number of stops for each truck on each day. Click a day to open its week.</p>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded border border-zinc-500/40 bg-zinc-500/40 text-sm">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="bg-[var(--background)] px-2 py-1 text-center font-semibold">
            {d}
          </div>
        ))}
        {cells.map((d) => {
          const key = iso(d);
          const c = counts.get(key);
          const inMonth = d.getMonth() === first.getMonth();
          const isToday = key === iso(today);
          return (
            <Link
              key={key}
              href={`/deliveries?week=${key}`}
              className={"flex min-h-20 flex-col gap-1 bg-[var(--background)] p-2 " + (inMonth ? "" : "opacity-50")}
            >
              <span className={isToday ? "w-fit rounded bg-[#FF5200] px-1.5 font-semibold text-white" : "font-semibold"}>{d.getDate()}</span>
              {c?.york ? <span>York {c.york}</span> : null}
              {c?.belfast ? <span>Belfast {c.belfast}</span> : null}
              {c && c.open === 0 ? <span className="font-semibold text-green-600">✓ done</span> : null}
            </Link>
          );
        })}
      </div>
    </main>
  );
}
