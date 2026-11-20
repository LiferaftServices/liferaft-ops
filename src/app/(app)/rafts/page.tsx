import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { DUE_LABELS, dueState, formatDate, isoDay, safeTerm } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

const LIMIT = 100;
const FILTERS = [
  ["all", "All"],
  ["due", "Due in 90 days"],
  ["overdue", "Overdue"],
  ["lapsed", "Lapsed"],
  ["loaners", "Loaners"],
] as const;

interface Row {
  id: string;
  serial_number: string | null;
  brand: string | null;
  capacity: number | null;
  equipment_type: string | null;
  customer_name: string | null;
  customer_qbo_id: string | null;
  vessel_name: string | null;
  next_service_due: string | null;
  last_serviced_on: string | null;
  is_loaner: boolean;
  retired: boolean;
  lapsed: boolean;
  confirmed: boolean;
}

export default async function Rafts({ searchParams }: PageProps<"/rafts">) {
  await requireStaff();
  const params = await searchParams;
  const q = typeof params.q === "string" ? safeTerm(params.q) : "";
  const show = FILTERS.some(([k]) => k === params.show) ? (params.show as string) : "all";

  const today = isoDay();
  const in90 = isoDay(90);

  const supabase = await createClient();
  let query = supabase
    .from("asset_overview")
    .select(
      "id, serial_number, brand, capacity, equipment_type, customer_name, customer_qbo_id, vessel_name, next_service_due, last_serviced_on, is_loaner, retired, lapsed, confirmed",
      { count: "exact" },
    )
    .eq("asset_type", "raft");
  if (q) query = query.ilike("search_text", `%${q.toLowerCase().split(/\s+/).join("%")}%`);
  if (show === "due") {
    query = query.eq("retired", false).eq("lapsed", false).gte("next_service_due", today).lte("next_service_due", in90);
  } else if (show === "overdue") {
    query = query.eq("retired", false).eq("lapsed", false).lt("next_service_due", today);
  } else if (show === "lapsed") {
    query = query.eq("lapsed", true);
  } else if (show === "loaners") {
    query = query.eq("is_loaner", true);
  }
  const ordered =
    show === "all" && !q
      ? query.order("last_serviced_on", { ascending: false, nullsFirst: false })
      : query.order("next_service_due", { ascending: true, nullsFirst: false });
  const { data, count, error } = await ordered.limit(LIMIT);
  const rows = (data as Row[] | null) ?? [];
  const link = (k: string) => `/rafts?show=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Rafts</h1>
        <form className="flex gap-2">
          <input type="hidden" name="show" value={show} />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Serial number, owner, vessel or brand"
            aria-label="Search rafts"
            className="w-full rounded border border-zinc-500/60 bg-transparent px-3 py-2"
          />
          <button type="submit" className="rounded bg-[#FF5200] px-4 py-2 font-semibold text-white">
            Search
          </button>
        </form>
        <nav className="flex flex-wrap gap-4 text-sm">
          {FILTERS.map(([k, label]) => (
            <Link key={k} href={link(k)} className={k === show ? "font-semibold" : "underline"}>
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <p className="text-sm opacity-75">
        {count != null
          ? count > rows.length
            ? `Showing ${rows.length} of ${count.toLocaleString("en-US")}`
            : `${count.toLocaleString("en-US")} found`
          : ""}
      </p>
      {error ? (
        <p className="text-red-700">Could not load rafts: {error.message}</p>
      ) : rows.length === 0 ? (
        <p>No rafts match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-500/40">
                <th className="py-2 pr-4 font-semibold">Serial</th>
                <th className="py-2 pr-4 font-semibold">Raft</th>
                <th className="py-2 pr-4 font-semibold">Owner</th>
                <th className="py-2 pr-4 font-semibold">Vessel</th>
                <th className="py-2 pr-4 font-semibold">Last service</th>
                <th className="py-2 pr-4 font-semibold">Next due</th>
                <th className="py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-500/20 align-top">
                  <td className="py-2 pr-4">
                    <Link className="font-semibold underline" href={`/rafts/${r.id}`}>
                      {r.serial_number ?? "No serial"}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    {[r.brand, r.capacity ? `${r.capacity}-person` : null, r.equipment_type]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                  <td className="py-2 pr-4">
                    {r.customer_qbo_id ? (
                      <Link className="underline" href={`/customers/${r.customer_qbo_id}`}>
                        {r.customer_name}
                      </Link>
                    ) : (
                      (r.customer_name ?? "")
                    )}
                  </td>
                  <td className="py-2 pr-4">{r.vessel_name ?? ""}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{formatDate(r.last_serviced_on)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{formatDate(r.next_service_due)}</td>
                  <td className="py-2 whitespace-nowrap">
                    {DUE_LABELS[dueState(r)]}
                    {r.is_loaner ? " · Loaner" : ""}
                    {r.confirmed ? "" : " · Unconfirmed"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
