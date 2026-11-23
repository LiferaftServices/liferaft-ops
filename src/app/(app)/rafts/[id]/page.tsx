import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { DUE_LABELS, dueState, formatDate, isoDay, safeTerm } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { BRANDS, EQUIPMENT_TYPES, PRIORITY_LABELS, SERVICE_CLASS_LABELS } from "@/lib/raft-options";
import { JobPhotos } from "@/components/job-photos";
import { getMode } from "@/lib/mode";
import { jobPhotos } from "@/lib/photo-data";
import { availableActions, MAIN_STAGES, STAGE_LABELS, type Stage } from "@/lib/workflow";
import { moveJob } from "../../board/actions";
import { changeOwner, checkIn, moveVessel, updateRaft } from "./actions";

export const instant = false;

const SOURCES: Record<string, string> = {
  quickbooks: "QuickBooks invoice",
  asana: "Asana task",
  fastfield: "FastField inspection",
  system: "This system",
};

const INPUT = "w-full rounded border border-zinc-500/60 bg-transparent px-2 py-1";
const BUTTON = "w-fit rounded bg-[#FF5200] px-3 py-1.5 font-semibold text-white";
const REASONS = ["Sold", "Moved to another vessel", "Correction"];

export default async function RaftPage({ params, searchParams }: PageProps<"/rafts/[id]">) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sp = await searchParams;
  const done = typeof sp.done === "string" ? sp.done : "";
  const failed = typeof sp.error === "string" ? sp.error : "";
  const ownerQ = typeof sp.owner_q === "string" ? safeTerm(sp.owner_q) : "";

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

  const [{ data: job }, { data: locations }] = await Promise.all([
    supabase
      .from("service_jobs")
      .select("id, job_number, stage, priority, date_received, locations(name)")
      .eq("asset_id", id)
      .is("closed_at", null)
      .maybeSingle(),
    supabase.from("locations").select("id, name").order("name"),
  ]);
  const { data: ownerRecord } = a?.customer_qbo_id
    ? await supabase.from("qbo_customers").select("active").eq("qbo_id", a.customer_qbo_id).maybeSingle()
    : { data: null };
  const [{ data: extra }, { data: events }] = await Promise.all([
    supabase.from("assets").select("approval_number").eq("id", id).maybeSingle(),
    supabase
      .from("job_events")
      .select("id, created_at, to_stage, note, job_id, service_jobs(job_number), staff:actor_id(full_name)")
      .eq("asset_id", id)
      .not("to_stage", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  // Stage changes grouped by job, newest job first, each job's steps in the order they happened.
  type Step = { id: number; when: string; stage: Stage; note: string | null; who: string | null };
  const timelines: { jobId: string; jobNumber: string; steps: Step[] }[] = [];
  for (const e of (events ?? []) as unknown as {
    id: number; created_at: string; to_stage: Stage; note: string | null; job_id: string | null;
    service_jobs: { job_number: string } | null; staff: { full_name: string } | null;
  }[]) {
    if (!e.job_id) continue;
    let t = timelines.find((x) => x.jobId === e.job_id);
    if (!t) timelines.push((t = { jobId: e.job_id, jobNumber: e.service_jobs?.job_number ?? "", steps: [] }));
    t.steps.unshift({ id: e.id, when: e.created_at, stage: e.to_stage, note: e.note, who: e.staff?.full_name ?? null });
  }
  // Photos for the job shown in the timeline: the open one, or the last one in.
  const photoJobId = timelines[0]?.jobId ?? null;
  const photos = photoJobId ? await jobPhotos(supabase, photoJobId) : [];
  const stamp = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const openJob = job as unknown as {
    id: string;
    job_number: string;
    stage: keyof typeof STAGE_LABELS;
    priority: string;
    date_received: string | null;
    locations: { name: string } | null;
  } | null;

  // Vessels on the owner's account, for the "move" list, and customer matches for "change owner".
  let accountId: string | null = a.customer_id;
  for (let i = 0; accountId && i < 6; i += 1) {
    const { data: c } = await supabase.from("customers").select("parent_id").eq("id", accountId).maybeSingle();
    if (!c?.parent_id) break;
    accountId = c.parent_id;
  }
  const { data: accountVessels } = accountId
    ? await supabase.from("vessels").select("id, name").eq("customer_id", accountId).order("name").limit(300)
    : { data: [] };
  const { data: matches } = ownerQ
    ? await supabase
        .from("qbo_customers")
        .select("qbo_id, fully_qualified_name, phone, email")
        .eq("active", true)
        .ilike("fully_qualified_name", `%${ownerQ.split(/\s+/).join("%")}%`)
        .order("fully_qualified_name")
        .limit(15)
    : { data: [] };

  const facts: [string, string][] = [
    ["Owner", a.customer_name ?? "Not linked"],
    ["Current vessel", a.vessel_name ?? "None"],
    ["Label ID", a.system_id],
    ["Brand", a.brand ?? ""],
    ["Model", a.model ?? ""],
    ["CG approval number", extra?.approval_number ?? ""],
    ["Capacity", a.capacity ? `${a.capacity}-person` : ""],
    ["Type", a.equipment_type ?? ""],
    ["Service class", a.service_class ? SERVICE_CLASS_LABELS[a.service_class] : "Not set"],
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

  // What can be done with this raft right now, shown first so a scan leads straight to the next step.
  const { data: board } = openJob
    ? await supabase
        .from("job_board")
        .select("stage_before_side, estimate_status, payment_status, payment_hold_exempt, payment_hold_acknowledged")
        .eq("id", openJob.id)
        .maybeSingle()
    : { data: null };
  const steps = openJob
    ? availableActions(
        {
          stage: openJob.stage,
          stageBeforeSide: (board?.stage_before_side ?? null) as Stage | null,
          estimateOpen: board?.estimate_status === "sent",
          paymentStatus: (board?.payment_status ?? "not_invoiced") as "not_invoiced" | "unpaid" | "pending" | "paid",
          customerPaymentHoldExempt: Boolean(board?.payment_hold_exempt),
          paymentHoldAcknowledged: Boolean(board?.payment_hold_acknowledged),
        },
        { role: staff.role, mode: await getMode() },
      )
    : [];
  const nextSteps = steps.filter((x) => (MAIN_STAGES as readonly string[]).includes(x.to));
  const otherSteps = steps.filter((x) => !(MAIN_STAGES as readonly string[]).includes(x.to));

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <header>
        <p className="text-sm">
          <Link className="underline" href="/rafts">
            Rafts
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{a.serial_number ?? "No serial"}</h1>
        <p className="mt-1 text-sm">
          <Link className="underline" href={`/rafts/${id}/label`}>
            Print QR label
          </Link>
        </p>
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

      {done ? (
        <p role="status" className="font-semibold">
          {done}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="font-semibold text-red-700">
          {failed}
        </p>
      ) : null}

      {openJob ? (
        <section className="rounded border-2 border-[#FF5200] p-4 text-sm">
          <h2 className="text-base font-semibold">
            In for service: {openJob.job_number} · {STAGE_LABELS[openJob.stage]}
          </h2>
          <p className="mt-1">
            {openJob.locations?.name ?? ""} · received {formatDate(openJob.date_received)} ·{" "}
            {PRIORITY_LABELS[openJob.priority] ?? openJob.priority}
          </p>
          {nextSteps.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {nextSteps.map((step) =>
                step.key.startsWith("invoice_for_") ? null : (
                  <form key={step.key} action={moveJob}>
                    <input type="hidden" name="job_id" value={openJob.id} />
                    <input type="hidden" name="action" value={step.key} />
                    <input type="hidden" name="back" value={`/rafts/${a.id}`} />
                    <button type="submit" className="rounded bg-[#FF5200] px-5 py-3 text-base font-semibold text-white">
                      {step.label}
                    </button>
                  </form>
                ),
              )}
              {nextSteps.some((step) => step.key.startsWith("invoice_for_")) ? (
                <Link href={`/jobs/${openJob.id}`} className="rounded bg-[#FF5200] px-5 py-3 text-base font-semibold text-white">
                  Review invoice items
                </Link>
              ) : null}
            </div>
          ) : (
            <p className="mt-2">Nothing to do at this stage in your current working mode. Switch mode on the service board.</p>
          )}
          {otherSteps.length ? (
            <details className="mt-3">
              <summary className="cursor-pointer underline">Other options</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {otherSteps.map((step) => (
                  <form key={step.key} action={moveJob}>
                    <input type="hidden" name="job_id" value={openJob.id} />
                    <input type="hidden" name="action" value={step.key} />
                    <input type="hidden" name="back" value={`/rafts/${a.id}`} />
                    <button type="submit" className="rounded border border-zinc-500/60 px-3 py-2">
                      {step.label}
                    </button>
                  </form>
                ))}
              </div>
            </details>
          ) : null}
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <Link className="font-semibold underline" href={`/jobs/${openJob.id}/inspection`}>
              Inspection
            </Link>
            <Link className="font-semibold underline" href={`/jobs/${openJob.id}`}>
              Parts and invoice
            </Link>
            <Link className="font-semibold underline" href={`/deliveries?raft=${a.id}`}>
              Add to a delivery or pickup
            </Link>
            <Link className="font-semibold underline" href="/board">
              Service board
            </Link>
          </p>
        </section>
      ) : null}

      {ownerRecord && !ownerRecord.active ? (
        <p role="alert" className="rounded border border-red-700 p-3 text-sm font-semibold">
          This raft&apos;s owner is inactive in QuickBooks, usually because the customer was merged into another record.
          Use Change owner below to move the raft to the surviving customer before invoicing.
        </p>
      ) : null}

      {timelines.length ? (
        <section className="text-sm">
          <h2 className="text-base font-semibold">
            {openJob ? "Progress on this job" : `Last time in: ${timelines[0].jobNumber}`}
          </h2>
          <ol className="mt-1">
            {timelines[0].steps.map((st) => (
              <li key={st.id} className="flex flex-wrap gap-x-3 border-b border-zinc-500/20 py-1.5">
                <span className="w-56 tabular-nums">{stamp(st.when)}</span>
                <span className="font-semibold">{STAGE_LABELS[st.stage]}</span>
                <span className="opacity-75">
                  {[st.who, st.note].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ol>
          {photoJobId ? (
            <details open={photos.some((p) => p.kind === "delivery")} className="mt-3">
              <summary className="cursor-pointer font-semibold underline">
                Photos for this service ({photos.length}), including delivery
              </summary>
              <div className="mt-2">
                <JobPhotos jobId={photoJobId} photos={photos} kinds={["delivery", "serial", "painter_op_head", "painter_raft", "other"]} canRemove={staff.role === "admin"} />
              </div>
            </details>
          ) : null}
          {timelines.length > 1 ? (
            <details className="mt-2">
              <summary className="cursor-pointer underline">Earlier jobs ({timelines.length - 1})</summary>
              {timelines.slice(1).map((t) => (
                <div key={t.jobId} className="mt-2">
                  <p className="font-semibold">{t.jobNumber}</p>
                  <ol>
                    {t.steps.map((st) => (
                      <li key={st.id} className="flex flex-wrap gap-x-3 py-1">
                        <span className="w-56 tabular-nums">{stamp(st.when)}</span>
                        <span>{STAGE_LABELS[st.stage]}</span>
                        <span className="opacity-75">{[st.who, st.note].filter(Boolean).join(" · ")}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </details>
          ) : null}
        </section>
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-1 text-sm">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="opacity-75">{k}</dt>
              <dd className={k === "Owner" || k === "Current vessel" ? "font-semibold" : undefined}>{v}</dd>
            </div>
          ))}
      </dl>

      {openJob ? null : (
        <details open={sp.checkin === "1"} className="rounded border border-zinc-500/40 p-4 text-sm">
          <summary className="cursor-pointer font-semibold">Check in for service</summary>
          <form action={checkIn} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={a.id} />
            <label>
              Shop
              <select name="location_id" required defaultValue="" className={INPUT}>
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
              <input name="pickup_location" placeholder="York drop off" className={INPUT} />
            </label>
            <label>
              Dropped off by
              <input name="dropped_off_by" className={INPUT} />
            </label>
            <label>
              Scheduled start (optional)
              <input type="date" name="scheduled_start" className={INPUT} />
            </label>
            <label>
              Scheduled due (optional)
              <input type="date" name="scheduled_due" className={INPUT} />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="estimate_required" /> Estimate wanted before work starts
            </label>
            <label className="sm:col-span-2">
              Notes / additional equipment
              <textarea name="notes" rows={3} className={INPUT} />
            </label>
            <button type="submit" className={`${BUTTON} sm:col-span-2`}>
              Check in
            </button>
          </form>
        </details>
      )}

      <details className="rounded border border-zinc-500/40 p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Edit details</summary>
        <form action={updateRaft} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={a.id} />
          <label>
            Serial number
            <input name="serial_number" defaultValue={a.serial_number ?? ""} required className={INPUT} />
          </label>
          <label>
            Brand (decides the certificate item)
            <select name="brand" defaultValue={a.brand ?? ""} className={INPUT}>
              <option value="">Not set</option>
              {BRANDS.map((b) => (
                <option key={b}>{b}</option>
              ))}
              {a.brand && !(BRANDS as readonly string[]).includes(a.brand) ? <option>{a.brand}</option> : null}
            </select>
          </label>
          <label>
            Model
            <input name="model" defaultValue={a.model ?? ""} className={INPUT} />
          </label>
          <label>
            CG approval number
            <input name="approval_number" defaultValue={extra?.approval_number ?? ""} placeholder="160.151/121/3" className={INPUT} />
          </label>
          <label>
            Capacity (persons)
            <input name="capacity" inputMode="numeric" defaultValue={a.capacity ?? ""} className={INPUT} />
          </label>
          <label>
            Type
            <select name="equipment_type" defaultValue={a.equipment_type ?? ""} className={INPUT}>
              <option value="">Not set</option>
              {EQUIPMENT_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
              {a.equipment_type && !(EQUIPMENT_TYPES as readonly string[]).includes(a.equipment_type) ? (
                <option>{a.equipment_type}</option>
              ) : null}
            </select>
          </label>
          <label>
            Service class (decides the labor item)
            <select name="service_class" defaultValue={a.service_class ?? ""} className={INPUT}>
              <option value="">Not set</option>
              {Object.entries(SERVICE_CLASS_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Manufactured
            <input type="date" name="manufacture_date" defaultValue={a.manufacture_date ?? ""} className={INPUT} />
          </label>
          <label>
            Service interval (months)
            <input
              name="service_interval_months"
              inputMode="numeric"
              defaultValue={a.service_interval_months ?? ""}
              className={INPUT}
            />
          </label>
          <label>
            Next service due
            <input type="date" name="next_service_due" defaultValue={a.next_service_due ?? ""} className={INPUT} />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="is_loaner" defaultChecked={a.is_loaner} /> Loaner raft
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="lapsed" defaultChecked={a.lapsed} /> Lapsed (leave off reminders)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="retired" defaultChecked={a.retired} /> Retired (condemned or do not service)
          </label>
          <label>
            Reason, if retired
            <input name="retired_reason" className={INPUT} />
          </label>
          <button type="submit" className={`${BUTTON} sm:col-span-2`}>
            Save details
          </button>
        </form>
      </details>

      <details className="rounded border border-zinc-500/40 p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Move to another vessel</summary>
        {a.customer_id ? (
          <form action={moveVessel} className="mt-4 flex flex-col gap-3">
            <input type="hidden" name="id" value={a.id} />
            <label>
              Vessel on this customer&apos;s account
              <select name="vessel_id" defaultValue={a.vessel_id ?? ""} className={INPUT}>
                <option value="">No vessel</option>
                {(accountVessels ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Or a new vessel name
              <input name="new_vessel" placeholder="F/V …" className={INPUT} />
            </label>
            <label>
              Reason
              <select name="reason" defaultValue="Moved to another vessel" className={INPUT}>
                {REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <button type="submit" className={BUTTON}>
              Move raft
            </button>
          </form>
        ) : (
          <p className="mt-3">This raft has no owner yet. Use Change owner first.</p>
        )}
      </details>

      <details open={!!ownerQ} className="rounded border border-zinc-500/40 p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Change owner</summary>
        <form className="mt-4 flex gap-2">
          <input
            type="search"
            name="owner_q"
            defaultValue={ownerQ}
            placeholder="Search QuickBooks customers"
            aria-label="Search QuickBooks customers"
            className={INPUT}
          />
          <button type="submit" className={BUTTON}>
            Search
          </button>
        </form>
        {ownerQ && (matches ?? []).length === 0 ? (
          <p className="mt-3">
            No active QuickBooks customer matches. New customers can be added once intake is built.
          </p>
        ) : null}
        <ul className="mt-3 flex flex-col gap-3">
          {(matches ?? []).map((m) => (
            <li key={m.qbo_id} className="border-t border-zinc-500/20 pt-3">
              <p className="font-semibold">{m.fully_qualified_name}</p>
              <p className="opacity-75">{[m.phone, m.email].filter(Boolean).join(" · ")}</p>
              <form action={changeOwner} className="mt-2 flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="qbo_id" value={m.qbo_id} />
                <label>
                  Vessel (optional)
                  <input name="new_vessel" placeholder="F/V …" className={INPUT} />
                </label>
                <label>
                  Reason
                  <select name="reason" defaultValue="Sold" className={INPUT}>
                    {REASONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" className={BUTTON}>
                  Assign to this customer
                </button>
              </form>
            </li>
          ))}
        </ul>
      </details>

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
                {o.reason && !o.reason.startsWith("Imported") ? ` · ${o.reason}` : ""}
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
