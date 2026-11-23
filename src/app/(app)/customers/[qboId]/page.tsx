import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { DUE_LABELS, dueState, formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { saveCustomerSettings } from "./actions";

export const instant = false;

export default async function CustomerPage({ params, searchParams }: PageProps<"/customers/[qboId]">) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const { qboId } = await params;
  if (!/^\d+$/.test(qboId)) notFound();

  const supabase = await createClient();
  const [{ data: q }, { data: subs }, { data: local }] = await Promise.all([
    supabase.from("qbo_customers").select("*").eq("qbo_id", qboId).maybeSingle(),
    supabase
      .from("qbo_customers")
      .select("qbo_id, display_name, active")
      .eq("parent_qbo_id", qboId)
      .order("display_name")
      .limit(500),
    supabase
      .from("customers")
      .select("id, notes, customer_type, no_reminders, partner_account, payment_hold_exempt")
      .eq("qbo_customer_id", qboId)
      .maybeSingle(),
  ]);
  if (!q) notFound();

  const [{ data: rafts }, { data: vessels }] = local
    ? await Promise.all([
        supabase
          .from("asset_overview")
          .select("id, serial_number, brand, capacity, equipment_type, vessel_name, next_service_due, last_serviced_on, retired, lapsed, is_loaner")
          .eq("customer_id", local.id)
          .order("next_service_due", { ascending: true, nullsFirst: false })
          .limit(500),
        supabase.from("vessels").select("id, name").eq("customer_id", local.id).order("name").limit(500),
      ])
    : [{ data: [] }, { data: [] }];

  const address = q.bill_address as Record<string, string> | null;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <header>
        <p className="text-sm">
          <Link className="underline" href={q.parent_qbo_id ? `/customers/${q.parent_qbo_id}` : "/customers"}>
            {q.parent_qbo_id ? "Parent customer" : "Customers"}
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{q.display_name}</h1>
        {q.parent_qbo_id ? <p className="text-sm opacity-75">{q.fully_qualified_name}</p> : null}
        <p className="mt-2 text-sm">
          {[q.phone ?? q.mobile, q.email].filter(Boolean).join(" · ")}
          {q.active ? "" : " · Inactive in QuickBooks"}
        </p>
        {address ? (
          <p className="mt-1 text-sm whitespace-pre-line">
            {[address.lines, [address.city, address.state, address.postal_code].filter(Boolean).join(", ")]
              .filter(Boolean)
              .join("\n")}
          </p>
        ) : null}
        {q.balance ? (
          <p className="mt-2 text-sm font-semibold">Open balance: ${Number(q.balance).toFixed(2)}</p>
        ) : null}
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
      {!q.active ? (
        <p role="alert" className="rounded border border-red-700 p-3 text-sm font-semibold">
          This customer is inactive in QuickBooks, usually because it was merged into another record. Move its rafts to
          the surviving customer with Change owner on each raft.
        </p>
      ) : null}

      <details className="rounded border border-zinc-500/40 p-4 text-sm" open={Boolean(local?.no_reminders || local?.partner_account || local?.payment_hold_exempt || local?.customer_type)}>
        <summary className="cursor-pointer text-base font-semibold">
          Settings in this system
          <span className="font-normal opacity-75">
            {" "}
            {[
              local?.customer_type === "seasonal" ? "Seasonal" : local?.customer_type === "full_time" ? "Full time" : local?.customer_type === "recreational" ? "Recreational" : null,
              local?.partner_account ? "Partner account" : null,
              local?.no_reminders ? "No reminders" : null,
              local?.payment_hold_exempt ? "Exempt from payment hold" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </summary>
        <form action={saveCustomerSettings} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="qbo_id" value={qboId} />
          <label className="w-fit">
            Customer type
            <select name="customer_type" defaultValue={local?.customer_type ?? ""} className="block rounded border border-zinc-500/60 bg-transparent px-2 py-1.5">
              <option value="">Not set</option>
              <option value="seasonal">Seasonal (hauls the boat for winter)</option>
              <option value="full_time">Full time (fishes year round)</option>
              <option value="recreational">Recreational</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="partner_account" defaultChecked={local?.partner_account ?? false} /> Partner account (a yard,
            dealer or other service station; we deal with them, not the boat owners)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="no_reminders" defaultChecked={local?.no_reminders ?? false} /> Do not send service reminders
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="payment_hold_exempt"
              defaultChecked={local?.payment_hold_exempt ?? false}
              disabled={staff.role !== "admin"}
            />{" "}
            Rafts may leave before the invoice is paid{staff.role !== "admin" ? " (admin only)" : ""}
          </label>
          <label>
            Notes
            <textarea name="notes" defaultValue={local?.notes ?? ""} rows={2} className="block w-full rounded border border-zinc-500/60 bg-transparent px-2 py-1" />
          </label>
          <button type="submit" className="w-fit rounded bg-[#FF5200] px-3 py-1.5 font-semibold text-white">
            Save settings
          </button>
          <p className="opacity-75">Name, phone, email and address come from QuickBooks and are changed there.</p>
        </form>
      </details>

      <section>
        <h2 className="text-lg font-semibold">Rafts ({(rafts ?? []).length})</h2>
        {(rafts ?? []).length === 0 ? (
          <p className="mt-2 text-sm">No rafts on record for this customer.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-500/40">
                <th className="py-2 pr-4 font-semibold">Serial</th>
                <th className="py-2 pr-4 font-semibold">Raft</th>
                <th className="py-2 pr-4 font-semibold">Vessel</th>
                <th className="py-2 pr-4 font-semibold">Last service</th>
                <th className="py-2 pr-4 font-semibold">Next due</th>
                <th className="py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {(rafts ?? []).map((r) => (
                <tr key={r.id} className="border-b border-zinc-500/20">
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
                  <td className="py-2 pr-4">{r.vessel_name ?? ""}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{formatDate(r.last_serviced_on)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{formatDate(r.next_service_due)}</td>
                  <td className="py-2 whitespace-nowrap">
                    {DUE_LABELS[dueState(r)]}
                    {r.is_loaner ? " · Loaner" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {(vessels ?? []).length ? (
        <section>
          <h2 className="text-lg font-semibold">Vessels ({(vessels ?? []).length})</h2>
          <p className="mt-2 text-sm">{(vessels ?? []).map((v) => v.name).join(" · ")}</p>
        </section>
      ) : null}

      {(subs ?? []).length ? (
        <section>
          <h2 className="text-lg font-semibold">Sub-customers in QuickBooks ({(subs ?? []).length})</h2>
          <ul className="mt-2 columns-2 text-sm">
            {(subs ?? []).map((s) => (
              <li key={s.qbo_id}>
                <Link className="underline" href={`/customers/${s.qbo_id}`}>
                  {s.display_name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
