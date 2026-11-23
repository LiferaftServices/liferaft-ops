"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { getMode, MODE_COOKIE, MODES } from "@/lib/mode";
import { refreshPayment } from "@/lib/payments";
import { PHOTO_KINDS, REQUIRED_PHOTOS } from "@/lib/photos";
import { suggestSchedule } from "@/lib/turnaround";
import { createClient } from "@/lib/supabase/server";
import { checkMove, type Stage } from "@/lib/workflow";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const REASONS: Record<string, string> = {
  not_allowed: "That step is not available for this job in your current mode.",
  payment_hold: "The invoice is unpaid. An admin must acknowledge the hold before this raft leaves.",
  estimate_open: "An estimate is waiting on the customer.",
};

export async function setMode(form: FormData) {
  await requireStaff();
  const mode = String(form.get("mode") ?? "");
  if ((MODES as readonly string[]).includes(mode)) {
    (await cookies()).set(MODE_COOKIE, mode, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
  }
  revalidatePath("/board");
  redirect(String(form.get("back") ?? "/board").startsWith("/") ? String(form.get("back")) : "/board");
}

/** Moves a job one step. The workflow rules are checked here, on the server. */
export async function moveJob(form: FormData) {
  const staff = await requireStaff();
  const jobId = String(form.get("job_id") ?? "");
  const actionKey = String(form.get("action") ?? "");
  const backTo = String(form.get("back") ?? "/board");
  const back = backTo.startsWith("/") && !backTo.startsWith("//") ? backTo : "/board";
  const join = back.includes("?") ? "&" : "?";
  if (!UUID.test(jobId)) redirect(back);

  const supabase = await createClient();
  // Before a raft leaves, ask QuickBooks whether its invoice has been paid since we last looked.
  if (["load", "deliver", "customer_collects"].includes(actionKey)) {
    await refreshPayment(supabase, jobId).catch(() => null);
  }
  if (actionKey === "transfer") {
    // A transfer puts the job on the other shop's board and remembers where it came in.
    if (staff.role !== "admin" && (await getMode()) !== "office") {
      redirect(`${back}${join}error=${encodeURIComponent("Switch to Office mode to transfer a raft.")}`);
    }
    const { data: shopName, error: transferError } = await supabase.rpc("transfer_job", { p_job: jobId });
    revalidatePath("/board");
    redirect(
      `${back}${join}${transferError ? "error" : "done"}=${encodeURIComponent(
        transferError ? transferError.message : `Transferred. The raft is now on the ${shopName} board.`,
      )}`,
    );
  }
  if (actionKey === "invoice_for_delivery" || actionKey === "invoice_for_pickup") {
    redirect(`/jobs/${jobId}`); // invoices are approved on the job page, where the parts list is reviewed
  }
  const { data: job } = await supabase.from("job_board").select("*").eq("id", jobId).maybeSingle();
  if (!job) redirect(`${back}${join}error=${encodeURIComponent("That job is closed or no longer exists.")}`);

  if (actionKey === "complete_inspection") {
    // The safety-check photos are taken fresh at every service and must be on this job.
    const { data: taken } = await supabase.from("job_photos").select("kind").eq("job_id", jobId);
    const missing = REQUIRED_PHOTOS.filter((k) => !(taken ?? []).some((p) => p.kind === k)).map((k) => PHOTO_KINDS[k].toLowerCase());
    if (missing.length) {
      redirect(`/jobs/${jobId}/inspection?error=${encodeURIComponent(`This service still needs its photos: ${missing.join("; ")}. Add them here, then complete the inspection.`)}`);
    }
  }
  const result = checkMove(
    {
      stage: job.stage as Stage,
      stageBeforeSide: job.stage_before_side as Stage | null,
      estimateOpen: job.estimate_status === "sent",
      paymentStatus: job.payment_status,
      customerPaymentHoldExempt: job.payment_hold_exempt,
      paymentHoldAcknowledged: job.payment_hold_acknowledged,
    },
    { role: staff.role, mode: await getMode() },
    actionKey,
  );
  if (!result.ok) redirect(`${back}${join}error=${encodeURIComponent(REASONS[result.reason])}`);

  const estimate =
    actionKey === "request_estimate" ? "sent" : actionKey === "estimate_approved" ? "approved" : null;
  const { error } = await supabase.rpc("move_job", {
    p_job: jobId,
    p_from: job.stage,
    p_to: result.to,
    p_action: actionKey,
    p_closes: result.closesJob,
    p_stage_before_side: result.stageBeforeSide,
    p_estimate_status: estimate,
    p_note: String(form.get("note") ?? "").slice(0, 500),
  });
  if (!error && actionKey === "complete_inspection") {
    // Use the work date and dated-as month from the inspection for the raft's service dates.
    await supabase.rpc("apply_inspection_dates", { p_job: jobId });
  }
  if (error) redirect(`${back}${join}error=${encodeURIComponent(error.message)}`);
  revalidatePath("/board");
  revalidatePath(`/rafts/${job.asset_id}`);
  redirect(`${back}${join}done=${encodeURIComponent(`${job.job_number} moved.`)}`);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function safeBack(form: FormData): { back: string; join: string } {
  const raw = String(form.get("back") ?? "/board");
  const back = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/board";
  return { back, join: back.includes("?") ? "&" : "?" };
}

/** Sets or clears a job's planned start and due dates. */
export async function setSchedule(form: FormData) {
  await requireStaff();
  const { back, join } = safeBack(form);
  const jobId = String(form.get("job_id") ?? "");
  const start = String(form.get("scheduled_start") ?? "");
  const due = String(form.get("scheduled_due") ?? "");
  if (!UUID.test(jobId)) redirect(back);
  if ((start && !DATE.test(start)) || (due && !DATE.test(due))) {
    redirect(`${back}${join}error=${encodeURIComponent("A date was not understood.")}`);
  }
  if (start && due && due < start) {
    redirect(`${back}${join}error=${encodeURIComponent("The due date cannot be before the start date.")}`);
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("service_jobs")
    .update({ scheduled_start: start || null, scheduled_due: due || null })
    .eq("id", jobId)
    .is("closed_at", null);
  if (error) redirect(`${back}${join}error=${encodeURIComponent(error.message)}`);
  revalidatePath("/board");
  redirect(`${back}${join}done=${encodeURIComponent("Schedule saved.")}`);
}

/** Sets the turnaround a shop is quoting. Admins only. */
export async function setTurnaround(form: FormData) {
  const staff = await requireStaff();
  const { back, join } = safeBack(form);
  if (staff.role !== "admin") {
    redirect(`${back}${join}error=${encodeURIComponent("Only an admin can set the turnaround.")}`);
  }
  const location = String(form.get("location_id") ?? "");
  const days = String(form.get("days") ?? "").trim();
  const num = (key: string) => String(form.get(key) ?? "").trim();
  const fields = [days, num("batch_size"), num("batch_days"), num("handoff_days")];
  if (!UUID.test(location) || fields.some((v) => v && !/^\d{1,3}$/.test(v))) {
    redirect(`${back}${join}error=${encodeURIComponent("Enter whole numbers only.")}`);
  }
  const orNull = (v: string) => (v ? Number(v) : null);
  const supabase = await createClient();
  const { error } = await supabase
    .from("locations")
    .update({
      turnaround_days: orNull(days),
      batch_size: orNull(num("batch_size")) || null,
      batch_days: orNull(num("batch_days")) || null,
      handoff_days: orNull(num("handoff_days")),
      turnaround_set_at: new Date().toISOString(),
      turnaround_set_by: staff.id,
    })
    .eq("id", location);
  if (error) redirect(`${back}${join}error=${encodeURIComponent(error.message)}`);
  revalidatePath("/board");
  redirect(`${back}${join}done=${encodeURIComponent("Turnaround updated.")}`);
}

/** Fills in suggested start and due dates for the waiting rafts in a shop that have none yet. */
export async function applySuggestedSchedule(form: FormData) {
  const staff = await requireStaff();
  const { back, join } = safeBack(form);
  const locationId = String(form.get("location_id") ?? "");
  if (!UUID.test(locationId)) redirect(back);
  if (staff.role !== "admin" && (await getMode()) !== "office") {
    redirect(`${back}${join}error=${encodeURIComponent("Switch to Office mode to schedule rafts.")}`);
  }
  const supabase = await createClient();
  const [{ data: shop }, { data: jobs }] = await Promise.all([
    supabase.from("locations").select("batch_size, batch_days, handoff_days").eq("id", locationId).maybeSingle(),
    supabase.from("job_board").select("id, stage, priority, date_received, scheduled_start").eq("location_id", locationId).in("stage", ["received", "incoming", "on_floor", "awaiting_estimate"]),
  ]);
  if (!shop?.batch_size || !shop.batch_days) {
    redirect(`${back}${join}error=${encodeURIComponent("Set the batch size and days for this shop first.")}`);
  }
  const waiting = (jobs ?? []).filter((j) => (j.stage === "received" || j.stage === "incoming") && !j.scheduled_start);
  const plan = suggestSchedule(
    waiting.map((j) => ({ id: j.id, priority: j.priority, received: j.date_received })),
    (jobs ?? []).some((j) => j.stage === "on_floor" || j.stage === "awaiting_estimate"),
    { batchSize: shop!.batch_size, batchDays: shop!.batch_days, handoffDays: shop!.handoff_days ?? 0 },
    new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })),
  );
  for (const [id, dates] of plan) {
    await supabase.from("service_jobs").update({ scheduled_start: dates.start, scheduled_due: dates.due }).eq("id", id).is("scheduled_start", null).is("closed_at", null);
  }
  revalidatePath("/board");
  redirect(`${back}${join}done=${encodeURIComponent(`Suggested dates filled in for ${plan.size} waiting ${plan.size === 1 ? "raft" : "rafts"}. Change any of them under Schedule.`)}`);
}
