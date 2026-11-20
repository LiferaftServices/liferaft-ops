import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { DUE_LABELS, dueState, formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

const SOURCES: Record<string, string> = {
  quickbooks: "QuickBooks invoice",
  asana: "Asana task",
  fastfield: "FastField inspection",
  system: "This system",
};

export default async function RaftPage({ params }: PageProps<"/rafts/[id]">) {
  await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: a }, { data: owners }, { data: history }] = await Promise.all([
    supabase.from("asset_overview").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("asset_assignments")
      .select("id, effective_from, effective_to, reason, customers(name, qbo_customer_id), vessels(name)")
      .eq("asset_id", id)
      .order("effective_from", { ascending: false }),
    supabase
      .from("service_history")
      .select("id, serviced_on, source, customer_name, vessel_name, locations(name)")
      .eq("asset_id", id)
      .order("serviced_on", { ascending: false }),
  ]);
  if (!a) notFound();

  const facts: [string, string][] = [
    ["Label ID", a.system_id],
    ["Brand", a.brand ?? ""],
    ["Model", a.model ?? ""],
    ["Capacity", a.capacity ? `${a.capacity}-person` : ""],
    ["Type", a.equipment_type ?? ""],
    ["Manufactured", formatDate(a.manufacture_date)],
    ["Service interval", a.service_interval_months ? `${a.service_interval_months} months` : ""],
    ["Last service", formatDate(a.last_serviced_on)],
    ["Next service due", formatDate(a.next_service_due)],
    ["Status", DUE_LABELS[dueState(a)] + (a.is_loaner ? " · Loaner" : "")],
  ];

  type Owner = {
    id: string;
    effective_from: string;
    effective_to: string | null;
    reason: string | null;
    customers: { name: string; qbo_customer_id: string | null } | null;
    vessels: { name: string } | null;
  };
  type Service = {
    id: string;
    serviced_on: string;
    source: string;
    customer_name: string | null;
    vessel_name: string | null;
    locations: { name: string } | null;
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <header>
        <p className="text-sm">
          <Link className="underline" href="/rafts">
            Rafts
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{a.serial_number ?? "No serial"}</h1>
        <p className="mt-1">
          {a.customer_qbo_id ? (
            <Link className="underline" href={`/customers/${a.customer_qbo_id}`}>
              {a.customer_name}
            </Link>
          ) : (
            (a.customer_name ?? "No owner linked")
          )}
          {a.vessel_name ? ` · ${a.vessel_name}` : ""}
        </p>
        {a.confirmed ? null : (
          <p className="mt-2 text-sm">
            Unconfirmed: these details come from QuickBooks invoices only and may be out of date.
          </p>
        )}
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-1 text-sm">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="opacity-75">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>

      <section>
        <h2 className="text-lg font-semibold">Ownership</h2>
        <ul className="mt-2 text-sm">
          {((owners ?? []) as unknown as Owner[]).map((o) => (
            <li key={o.id} className="border-b border-zinc-500/20 py-2">
              <span className="font-semibold">{o.customers?.name ?? "Unknown"}</span>
              {o.vessels?.name ? ` · ${o.vessels.name}` : ""}
              <span className="opacity-75">
                {" "}
                · {formatDate(o.effective_from)} to {o.effective_to ? formatDate(o.effective_to) : "now"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Service history</h2>
        {(history ?? []).length === 0 ? (
          <p className="mt-2 text-sm">No past services on record.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-500/40">
                <th className="py-2 pr-4 font-semibold">Date</th>
                <th className="py-2 pr-4 font-semibold">Record</th>
                <th className="py-2 pr-4 font-semibold">Shop</th>
                <th className="py-2 font-semibold">Customer and vessel as written</th>
              </tr>
            </thead>
            <tbody>
              {((history ?? []) as unknown as Service[]).map((h) => (
                <tr key={h.id} className="border-b border-zinc-500/20">
                  <td className="py-2 pr-4 whitespace-nowrap">{formatDate(h.serviced_on)}</td>
                  <td className="py-2 pr-4">{SOURCES[h.source] ?? h.source}</td>
                  <td className="py-2 pr-4">{h.locations?.name ?? ""}</td>
                  <td className="py-2">
                    {[h.customer_name, h.vessel_name].filter(Boolean).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
