"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { getMode, MODE_COOKIE, MODES } from "@/lib/mode";
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
  const { data: job } = await supabase.from("job_board").select("*").eq("id", jobId).maybeSingle();
  if (!job) redirect(`${back}${join}error=${encodeURIComponent("That job is closed or no longer exists.")}`);

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
  if (error) redirect(`${back}${join}error=${encodeURIComponent(error.message)}`);
  revalidatePath("/board");
  revalidatePath(`/rafts/${job.asset_id}`);
  redirect(`${back}${join}done=${encodeURIComponent(`${job.job_number} moved.`)}`);
}
