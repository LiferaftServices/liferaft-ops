import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { formatDate, isoDay } from "@/lib/format";
import { getMode, MODE_LABELS, MODES } from "@/lib/mode";
import { PRIORITY_LABELS } from "@/lib/raft-options";
import { createClient } from "@/lib/supabase/server";
import { calculatedTurnaround, describeDays, measuredTurnaround } from "@/lib/turnaround";
import { availableActions, MAIN_STAGES, SIDE_STAGES, STAGE_LABELS, type Stage } from "@/lib/workflow";
import { moveJob, setMode, setSchedule, setTurnaround } from "./actions";

export const instant = false;

interface Job {
  id: string;
  job_number: string;
  stage: Stage;
  stage_before_side: Stage | null;
  priority: string;
  estimate_status: string;
  payment_status: "not_invoiced" | "unpaid" | "pending" | "paid";
  date_received: string | null;
  location_id: string;
  location_name: string;
  notes: string | null;
  payment_hold_acknowledged: boolean;
  payment_hold_exempt: boolean;
  asset_id: string;
  serial_number: string | null;
  brand: string | null;
  capacity: number | null;
  equipment_type: string | null;
  customer_name: string | null;
  vessel_name: string | null;
  is_loaner: boolean;
  scheduled_start: string | null;
  scheduled_due: string | null;
}

const SORTS = [
  ["stage", "Stage"],
  ["start", "Start date"],
  ["due", "Due date"],
  ["received", "Date received"],
  ["priority", "Priority"],
] as const;
type Sort = (typeof SORTS)[number][0];

const PRIORITY_ORDER = ["hot", "scheduled", "normal", "seasonal", "winter_storage"];

export default async function Board({ searchParams }: PageProps<"/board">) {
  const staff = await requireStaff();
  const mode = await getMode();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: locations }, { data: me }] = await Promise.all([
    supabase.from("locations").select("id, name, turnaround_days, turnaround_set_at, batch_size, batch_days, handoff_days").order("name"),
    supabase.from("staff").select("home_location_id").eq("id", staff.id).maybeSingle(),
  ]);
  const sort: Sort = SORTS.some(([k]) => k === sp.sort) ? (sp.sort as Sort) : "stage";
  const shopParam = typeof sp.shop === "string" ? sp.shop : "";
  const shop =
    shopParam === "all"
      ? "all"
      : ((locations ?? []).find((l) => l.id === shopParam)?.id ?? me?.home_location_id ?? "all");

  let query = supabase.from("job_board").select("*").order("date_received", { ascending: true }).limit(1000);
  if (shop !== "all") query = query.eq("location_id", shop);
  const { data, error } = await query;
  // Dates sort earliest first, with undated jobs last.
  const byDate = (key: "scheduled_start" | "scheduled_due" | "date_received") => (a: Job, b: Job) =>
    (a[key] ?? "9999").localeCompare(b[key] ?? "9999");
  const byPriority = (a: Job, b: Job) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
  const jobs = ((data as Job[] | null) ?? []).sort(
    sort === "start" ? byDate("scheduled_start") : sort === "due" ? byDate("scheduled_due") : sort === "received" ? byDate("date_received") : byPriority,
  );
  const here = `/board?shop=${shop}&sort=${sort}`;

  // Turnaround: the figure each shop is quoting, and what recent jobs actually took.
  const { data: recent } = await supabase
    .from("service_history")
    .select("serviced_on, location_id, service_jobs(date_received)")
    .eq("source", "system")
    .gte("serviced_on", isoDay(-45))
    .limit(2000);
  const shownShops = (locations ?? []).filter((l) => shop === "all" || l.id === shop);
  const turnaround = shownShops.map((l) => {
    const mine = jobs.filter((j) => j.location_id === l.id);
    const waiting = mine.filter((j) => j.stage === "received" || j.stage === "incoming").length;
    const onFloor = mine.filter((j) => j.stage === "on_floor" || j.stage === "awaiting_estimate").length;
    const calculated =
      l.batch_size && l.batch_days
        ? calculatedTurnaround(waiting, onFloor, { batchSize: l.batch_size, batchDays: l.batch_days, handoffDays: l.handoff_days ?? 0 })
        : null;
    return {
    ...l,
    waiting,
    onFloor,
    calculated,
    measured: measuredTurnaround(
      ((recent ?? []) as unknown as { serviced_on: string; location_id: string; service_jobs: { date_received: string | null } | null }[])
        .filter((r) => r.location_id === l.id)
        .map((r) => ({ received: r.service_jobs?.date_received ?? null, servicedOn: r.serviced_on })),
    ),
  };
  });
  const todayIso = isoDay();
  const done = typeof sp.done === "string" ? sp.done : "";
  const failed = typeof sp.error === "string" ? sp.error : "";
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  const daysIn = (d: string | null) => (d ? Math.max(0, Math.round((today - Date.parse(d)) / 86_400_000)) : null);

  const stages = [...MAIN_STAGES, ...SIDE_STAGES].filter((s) => jobs.some((j) => j.stage === s));
  // Sorted by stage, jobs are grouped under stage headings. Any other sort is one list.
  const groups: { key: string; title: string; list: Job[] }[] =
    sort === "stage"
      ? stages.map((stage) => ({ key: stage, title: STAGE_LABELS[stage], list: jobs.filter((j) => j.stage === stage) }))
      : jobs.length
        ? [{ key: "all", title: `All open jobs by ${SORTS.find(([k]) => k === sort)![1].toLowerCase()}`, list: jobs }]
        : [];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Service board</h1>
          <nav className="mt-2 flex flex-wrap gap-4 text-sm">
            {(locations ?? []).map((l) => (
              <Link key={l.id} href={`/board?shop=${l.id}&sort=${sort}`} className={shop === l.id ? "font-semibold" : "underline"}>
                {l.name}
              </Link>
            ))}
            <Link href={`/board?shop=all&sort=${sort}`} className={shop === "all" ? "font-semibold" : "underline"}>
              Both shops
            </Link>
          </nav>
          <nav className="mt-2 flex flex-wrap gap-4 text-sm">
            <span className="opacity-75">Sort by</span>
            {SORTS.map(([k, label]) => (
              <Link key={k} href={`/board?shop=${shop}&sort=${k}`} className={k === sort ? "font-semibold" : "underline"}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <form action={setMode} className="flex items-center gap-2 text-sm">
          <input type="hidden" name="back" value={here} />
          <span>Working as</span>
          {MODES.map((m) => (
            <button
              key={m}
              type="submit"
              name="mode"
              value={m}
              className={
                m === mode
                  ? "rounded bg-[#FF5200] px-3 py-1 font-semibold text-white"
                  : "rounded border border-zinc-500/60 px-3 py-1"
              }
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </form>
      </header>

      <section className="flex flex-wrap gap-4">
        {turnaround.map((t) => (
          <div key={t.id} className="min-w-64 flex-1 rounded border border-[#FF5200] p-4">
            <p className="text-sm">{t.name}: turnaround for a raft received today</p>
            <p className="text-2xl font-semibold">
              {t.turnaround_days != null
                ? describeDays(t.turnaround_days)
                : t.calculated != null
                  ? describeDays(t.calculated)
                  : "Not set"}
            </p>
            <p className="text-sm">
              {t.calculated != null
                ? `Calculated: ${describeDays(t.calculated)} (${t.waiting} waiting, ${t.onFloor} on the floor, batches of ${t.batch_size} every ${t.batch_days} working days).`
                : "Enter the batch size and days to get a calculated figure."}
              {t.turnaround_days != null && t.calculated != null && Math.abs(t.turnaround_days - t.calculated) >= 4
                ? " The quoted figure differs from the calculation."
                : ""}
            </p>
            <p className="text-sm opacity-75">
              {t.turnaround_days != null && t.turnaround_set_at ? `Quoted figure set by hand ${formatDate(t.turnaround_set_at)}. ` : ""}
              {t.measured
                ? `Last ${t.measured.count} jobs took ${describeDays(t.measured.days)} from arrival to sign-off.`
                : "Not enough completed jobs here yet to measure."}
            </p>
            {staff.role === "admin" ? (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer underline">Adjust</summary>
                <form action={setTurnaround} className="mt-2 grid grid-cols-2 gap-2">
                  <input type="hidden" name="location_id" value={t.id} />
                  <input type="hidden" name="back" value={here} />
                  {(
                    [
                      ["days", "Quote this many days (blank = use the calculation)", t.turnaround_days],
                      ["batch_size", "Rafts per batch", t.batch_size],
                      ["batch_days", "Working days per batch", t.batch_days],
                      ["handoff_days", "Working days for invoice and return", t.handoff_days],
                    ] as const
                  ).map(([name, label, value]) => (
                    <label key={name}>
                      {label}
                      <input
                        name={name}
                        inputMode="numeric"
                        defaultValue={value ?? ""}
                        className="block w-24 rounded border border-zinc-500/60 bg-transparent px-2 py-1"
                      />
                    </label>
                  ))}
                  <button type="submit" className="col-span-2 w-fit rounded border border-zinc-500/60 px-3 py-1">
                    Save
                  </button>
                </form>
              </details>
            ) : null}
          </div>
        ))}
      </section>

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
      {error ? <p className="text-red-700">Could not load jobs: {error.message}</p> : null}
      {jobs.length === 0 && !error ? (
        <p>
          No open jobs here. Check a raft in from{" "}
          <Link className="underline" href="/intake">
            Intake
          </Link>
          .
        </p>
      ) : null}

      {groups.map(({ key, title, list }) => {
        return (
          <section key={key}>
            <h2 className="border-b border-zinc-500/40 pb-1 text-lg font-semibold">
              {title} <span className="font-normal opacity-75">({list.length})</span>
            </h2>
            <ul>
              {list.map((j) => {
                const actions = availableActions(
                  {
                    stage: j.stage,
                    stageBeforeSide: j.stage_before_side,
                    estimateOpen: j.estimate_status === "sent",
                    paymentStatus: j.payment_status,
                    customerPaymentHoldExempt: j.payment_hold_exempt,
                    paymentHoldAcknowledged: j.payment_hold_acknowledged,
                  },
                  { role: staff.role, mode },
                );
                const days = daysIn(j.date_received);
                return (
                  <li key={j.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-500/20 py-3 text-sm">
                    <div className="min-w-64 flex-1">
                      <p>
                        <Link className="font-semibold underline" href={`/rafts/${j.asset_id}`}>
                          {j.serial_number ?? "No serial"}
                        </Link>{" "}
                        <Link className="underline" href={`/jobs/${j.id}`}>
                          {j.job_number} parts
                        </Link>
                        {j.priority !== "normal" ? (
                          <span className={j.priority === "hot" ? "ml-2 font-semibold text-[#FF5200]" : "ml-2 font-semibold"}>
                            {PRIORITY_LABELS[j.priority] ?? j.priority}
                          </span>
                        ) : null}
                        {j.estimate_status === "required" ? <span className="ml-2 font-semibold">Estimate wanted</span> : null}
                      </p>
                      <p>
                        {j.customer_name ?? "No owner"}
                        {j.vessel_name ? ` · ${j.vessel_name}` : ""}
                      </p>
                      <p className="opacity-75">
                        {[j.brand, j.capacity ? `${j.capacity}-person` : null, j.equipment_type].filter(Boolean).join(" · ")}
                        {shop === "all" ? ` · ${j.location_name}` : ""}
                        {j.date_received ? ` · received ${formatDate(j.date_received)}` : ""}
                        {days !== null ? ` (${days} ${days === 1 ? "day" : "days"})` : ""}
                      </p>
                      <p>
                        {sort !== "stage" ? <span className="font-semibold">{STAGE_LABELS[j.stage]} · </span> : null}
                        {j.scheduled_start || j.scheduled_due ? (
                          <>
                            Start {j.scheduled_start ? formatDate(j.scheduled_start) : "not set"} · due{" "}
                            <span className={j.scheduled_due && j.scheduled_due < todayIso ? "font-semibold text-red-700" : undefined}>
                              {j.scheduled_due ? formatDate(j.scheduled_due) : "not set"}
                              {j.scheduled_due && j.scheduled_due < todayIso ? " (past due)" : ""}
                            </span>
                          </>
                        ) : (
                          <span className="opacity-75">Not scheduled</span>
                        )}
                      </p>
                      {j.notes ? <p className="mt-1 whitespace-pre-line">{j.notes}</p> : null}
                      <details className="mt-1">
                        <summary className="cursor-pointer underline">Schedule</summary>
                        <form action={setSchedule} className="mt-2 flex flex-wrap items-end gap-2">
                          <input type="hidden" name="job_id" value={j.id} />
                          <input type="hidden" name="back" value={here} />
                          <label>
                            Start
                            <input type="date" name="scheduled_start" defaultValue={j.scheduled_start ?? ""} className="block rounded border border-zinc-500/60 bg-transparent px-2 py-1" />
                          </label>
                          <label>
                            Due
                            <input type="date" name="scheduled_due" defaultValue={j.scheduled_due ?? ""} className="block rounded border border-zinc-500/60 bg-transparent px-2 py-1" />
                          </label>
                          <button type="submit" className="rounded border border-zinc-500/60 px-3 py-1">
                            Save
                          </button>
                        </form>
                      </details>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {actions.map((a) => (
                        <form key={a.key} action={moveJob}>
                          <input type="hidden" name="job_id" value={j.id} />
                          <input type="hidden" name="action" value={a.key} />
                          <input type="hidden" name="back" value={here} />
                          <button
                            type="submit"
                            className={
                              (MAIN_STAGES as readonly string[]).includes(a.to)
                                ? "rounded bg-[#FF5200] px-3 py-1.5 font-semibold text-white"
                                : "rounded border border-zinc-500/60 px-3 py-1.5"
                            }
                          >
                            {a.label}
                          </button>
                        </form>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
