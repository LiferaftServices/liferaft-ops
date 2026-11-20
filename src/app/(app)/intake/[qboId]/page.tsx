import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { formatDate, isoDay } from "@/lib/format";
import { BRANDS, EQUIPMENT_TYPES, PRIORITY_LABELS } from "@/lib/raft-options";
import { createClient } from "@/lib/supabase/server";
import { registerRaft } from "./actions";

export const instant = false;

const INPUT = "w-full rounded border border-zinc-500/60 bg-transparent px-3 py-2";

export default async function IntakeCustomer({ params, searchParams }: PageProps<"/intake/[qboId]">) {
  const staff = await requireStaff();
  const { qboId } = await params;
  if (!/^\d+$/.test(qboId)) notFound();
  const sp = await searchParams;
  const serial = typeof sp.serial === "string" ? sp.serial.slice(0, 60) : "";
  const failed = typeof sp.error === "string" ? sp.error : "";

  const supabase = await createClient();
  const [{ data: q }, { data: local }, { data: locations }, { data: me }] = await Promise.all([
    supabase.from("qbo_customers").select("qbo_id, display_name, fully_qualified_name, parent_qbo_id, phone, mobile, email, active").eq("qbo_id", qboId).maybeSingle(),
    supabase.from("customers").select("id, parent_id").eq("qbo_customer_id", qboId).maybeSingle(),
    supabase.from("locations").select("id, name").order("name"),
    supabase.from("staff").select("home_location_id").eq("id", staff.id).maybeSingle(),
  ]);
  if (!q) notFound();

  let accountId: string | null = local?.id ?? null;
  for (let i = 0; accountId && i < 6; i += 1) {
    const { data: c } = await supabase.from("customers").select("parent_id").eq("id", accountId).maybeSingle();
    if (!c?.parent_id) break;
    accountId = c.parent_id;
  }
  const [{ data: rafts }, { data: vessels }] = local
    ? await Promise.all([
        supabase.from("asset_overview").select("id, serial_number, brand, capacity, vessel_name, next_service_due").eq("customer_id", local.id).eq("retired", false).order("serial_number").limit(200),
        supabase.from("vessels").select("id, name").eq("customer_id", accountId ?? local.id).order("name").limit(300),
      ])
    : [{ data: [] }, { data: [] }];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header>
        <p className="text-sm">
          <Link className="underline" href="/intake">
            Intake
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{q.fully_qualified_name}</h1>
        <p className="mt-1 text-sm">{[q.phone ?? q.mobile, q.email].filter(Boolean).join(" · ")}</p>
        {sp.created ? <p className="mt-2 font-semibold">Customer added to QuickBooks.</p> : null}
        {q.active ? null : (
          <p className="mt-2 font-semibold text-red-700">
            This QuickBooks record is inactive or was merged. Choose the active record instead.
          </p>
        )}
      </header>
      {failed ? (
        <p role="alert" className="font-semibold text-red-700">
          {failed}
        </p>
      ) : null}

      {(rafts ?? []).length ? (
        <section>
          <h2 className="text-lg font-semibold">Rafts already on file</h2>
          <ul className="mt-2 text-sm">
            {(rafts ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-500/20 py-2">
                <span>
                  <span className="font-semibold">{r.serial_number}</span>{" "}
                  {[r.brand, r.capacity ? `${r.capacity}-person` : null, r.vessel_name].filter(Boolean).join(" · ")}
                  {r.next_service_due ? ` · due ${formatDate(r.next_service_due)}` : ""}
                </span>
                <Link className="font-semibold underline" href={`/rafts/${r.id}?checkin=1`}>
                  Check in
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="text-lg font-semibold">Register a new raft</h2>
        <form action={registerRaft} className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <input type="hidden" name="qbo_id" value={q.qbo_id} />
          <label className="sm:col-span-2">
            Serial number
            <input name="serial_number" defaultValue={serial} required autoComplete="off" className={INPUT} />
          </label>
          <label>
            Brand
            <select name="brand" required defaultValue="" className={INPUT}>
              <option value="" disabled>
                Choose…
              </option>
              {BRANDS.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select name="equipment_type" required defaultValue="" className={INPUT}>
              <option value="" disabled>
                Choose…
              </option>
              {EQUIPMENT_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Capacity (persons)
            <input name="capacity" inputMode="numeric" required className={INPUT} />
          </label>
          <label>
            Model (optional)
            <input name="model" autoComplete="off" className={INPUT} />
          </label>
          <label>
            Manufactured (month)
            <input type="month" name="manufacture_month" max={isoDay().slice(0, 7)} className={INPUT} />
          </label>
          <label>
            Shop
            <select name="location_id" required defaultValue={me?.home_location_id ?? ""} className={INPUT}>
              <option value="" disabled>
                Choose…
              </option>
              {(locations ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Vessel on this account
            <select name="vessel_id" defaultValue="" className={INPUT}>
              <option value="">None / not listed</option>
              {(vessels ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Or a new vessel name
            <input name="new_vessel" placeholder="F/V …" autoComplete="off" className={INPUT} />
          </label>

          <fieldset className="mt-2 grid grid-cols-1 gap-3 rounded border border-zinc-500/40 p-3 sm:col-span-2 sm:grid-cols-2">
            <legend className="px-1 font-semibold">Service check-in</legend>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input type="checkbox" name="check_in" defaultChecked /> The raft is here now: open a service job
            </label>
            <label>
              Date received
              <input type="date" name="date_received" defaultValue={isoDay()} max={isoDay()} className={INPUT} />
            </label>
            <label>
              Priority
              <select name="priority" defaultValue="normal" className={INPUT}>
                {Object.entries(PRIORITY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Pickup location / how it arrived
              <input name="pickup_location" placeholder="York drop off" autoComplete="off" className={INPUT} />
            </label>
            <label>
              Dropped off by
              <input name="dropped_off_by" autoComplete="off" className={INPUT} />
            </label>
            <label>
              Scheduled start (optional)
              <input type="date" name="scheduled_start" className={INPUT} />
            </label>
            <label>
              Scheduled due (optional)
              <input type="date" name="scheduled_due" className={INPUT} />
            </label>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input type="checkbox" name="estimate_required" /> Customer wants an estimate before work starts
            </label>
            <label className="sm:col-span-2">
              Notes / additional equipment
              <textarea name="notes" rows={3} className={INPUT} />
            </label>
          </fieldset>

          <button type="submit" className="w-fit rounded bg-[#FF5200] px-4 py-2 font-semibold text-white">
            Register raft
          </button>
        </form>
      </section>
    </main>
  );
}
