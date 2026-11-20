import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { getMode, MODE_LABELS, MODES } from "@/lib/mode";
import { PRIORITY_LABELS } from "@/lib/raft-options";
import { createClient } from "@/lib/supabase/server";
import { availableActions, MAIN_STAGES, SIDE_STAGES, STAGE_LABELS, type Stage } from "@/lib/workflow";
import { moveJob, setMode } from "./actions";

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
}

const PRIORITY_ORDER = ["hot", "scheduled", "normal", "seasonal", "winter_storage"];

export default async function Board({ searchParams }: PageProps<"/board">) {
  const staff = await requireStaff();
  const mode = await getMode();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: locations }, { data: me }] = await Promise.all([
    supabase.from("locations").select("id, name").order("name"),
    supabase.from("staff").select("home_location_id").eq("id", staff.id).maybeSingle(),
  ]);
  const shopParam = typeof sp.shop === "string" ? sp.shop : "";
  const shop =
    shopParam === "all"
      ? "all"
      : ((locations ?? []).find((l) => l.id === shopParam)?.id ?? me?.home_location_id ?? "all");

  let query = supabase.from("job_board").select("*").order("date_received", { ascending: true }).limit(1000);
  if (shop !== "all") query = query.eq("location_id", shop);
  const { data, error } = await query;
  const jobs = ((data as Job[] | null) ?? []).sort(
    (a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority),
  );
  const here = `/board?shop=${shop}`;
  const done = typeof sp.done === "string" ? sp.done : "";
  const failed = typeof sp.error === "string" ? sp.error : "";
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  const daysIn = (d: string | null) => (d ? Math.max(0, Math.round((today - Date.parse(d)) / 86_400_000)) : null);

  const stages = [...MAIN_STAGES, ...SIDE_STAGES].filter((s) => jobs.some((j) => j.stage === s));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Service board</h1>
          <nav className="mt-2 flex flex-wrap gap-4 text-sm">
            {(locations ?? []).map((l) => (
              <Link key={l.id} href={`/board?shop=${l.id}`} className={shop === l.id ? "font-semibold" : "underline"}>
                {l.name}
              </Link>
            ))}
            <Link href="/board?shop=all" className={shop === "all" ? "font-semibold" : "underline"}>
              Both shops
            </Link>
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

      {stages.map((stage) => {
        const list = jobs.filter((j) => j.stage === stage);
        return (
          <section key={stage}>
            <h2 className="border-b border-zinc-500/40 pb-1 text-lg font-semibold">
              {STAGE_LABELS[stage]} <span className="font-normal opacity-75">({list.length})</span>
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
                        <span className="opacity-75">{j.job_number}</span>
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
                      {j.notes ? <p className="mt-1 whitespace-pre-line">{j.notes}</p> : null}
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
