"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { findOrCreateVessel, resolveOwner, topAccount } from "@/lib/customers";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const orNull = (value: string) => (value ? value : null);

function back(id: string, kind: "done" | "error", message: string): never {
  redirect(`/rafts/${id}?${kind}=${encodeURIComponent(message)}`);
}

/** Saves edits to a raft's own details. */
export async function updateRaft(form: FormData) {
  await requireStaff();
  const id = text(form, "id");
  if (!UUID.test(id)) redirect("/rafts");

  const capacity = text(form, "capacity");
  const interval = text(form, "service_interval_months");
  if (capacity && !/^\d{1,3}$/.test(capacity)) back(id, "error", "Capacity must be a whole number.");
  if (interval && !(Number(interval) >= 1 && Number(interval) <= 120)) {
    back(id, "error", "Service interval must be between 1 and 120 months.");
  }
  for (const key of ["manufacture_date", "next_service_due"]) {
    const value = text(form, key);
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) back(id, "error", "A date was not understood.");
  }
  const serial = text(form, "serial_number");
  if (!serial) back(id, "error", "A raft needs a serial number.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("assets")
    .update({
      serial_number: serial,
      brand: orNull(text(form, "brand")),
      model: orNull(text(form, "model")),
      approval_number: orNull(text(form, "approval_number")),
      capacity: capacity ? Number(capacity) : null,
      equipment_type: orNull(text(form, "equipment_type")),
      service_class: ["raft", "iba", "coastal"].includes(text(form, "service_class")) ? text(form, "service_class") : null,
      manufacture_date: orNull(text(form, "manufacture_date")),
      service_interval_months: interval ? Number(interval) : null,
      next_service_due: orNull(text(form, "next_service_due")),
      is_loaner: form.get("is_loaner") === "on",
      lapsed: form.get("lapsed") === "on",
      retired: form.get("retired") === "on",
      retired_reason: form.get("retired") === "on" ? orNull(text(form, "retired_reason")) : null,
      confirmed: true, // a person has now looked at and saved these details
    })
    .eq("id", id);
  if (error) back(id, "error", `Could not save: ${error.message}`);
  revalidatePath(`/rafts/${id}`);
  back(id, "done", "Details saved.");
}

/** Moves a raft to another vessel of the same owner (or to no vessel). */
export async function moveVessel(form: FormData) {
  await requireStaff();
  const id = text(form, "id");
  if (!UUID.test(id)) redirect("/rafts");
  const supabase = await createClient();
  try {
    const { data: current } = await supabase
      .from("asset_assignments")
      .select("customer_id")
      .eq("asset_id", id)
      .is("effective_to", null)
      .maybeSingle();
    if (!current) throw new Error("This raft has no owner yet. Use Change owner first.");
    const chosen = text(form, "vessel_id");
    const typed = text(form, "new_vessel");
    let vesselId: string | null = null;
    if (typed) vesselId = await findOrCreateVessel(supabase, await topAccount(supabase, current.customer_id), typed);
    else if (UUID.test(chosen)) vesselId = chosen;
    const { error } = await supabase.rpc("reassign_asset", {
      p_asset: id,
      p_customer: current.customer_id,
      p_vessel: vesselId,
      p_reason: text(form, "reason") || "Moved to another vessel",
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    back(id, "error", err instanceof Error ? err.message : "Could not move the raft.");
  }
  revalidatePath(`/rafts/${id}`);
  back(id, "done", "Vessel updated. The previous one is kept in the ownership history.");
}

/** Hands a raft to a different QuickBooks customer, keeping the old owner in its history. */
export async function changeOwner(form: FormData) {
  await requireStaff();
  const id = text(form, "id");
  const qboId = text(form, "qbo_id");
  if (!UUID.test(id)) redirect("/rafts");
  if (!/^\d+$/.test(qboId)) back(id, "error", "Choose a customer from the search results.");
  const supabase = await createClient();
  try {
    const owner = await resolveOwner(supabase, qboId);
    const customerId = owner.customerId;
    let vesselId = owner.vesselId;
    const typed = text(form, "new_vessel");
    if (typed) vesselId = await findOrCreateVessel(supabase, await topAccount(supabase, customerId), typed);
    const { error } = await supabase.rpc("reassign_asset", {
      p_asset: id,
      p_customer: customerId,
      p_vessel: vesselId,
      p_reason: text(form, "reason") || "Change of owner",
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    back(id, "error", err instanceof Error ? err.message : "Could not change the owner.");
  }
  revalidatePath(`/rafts/${id}`);
  back(id, "done", "Owner updated. The previous owner is kept in the ownership history.");
}

/** Saves planned dates on a job that was just opened. Returns a message if they could not be saved. */
async function saveSchedule(db: Awaited<ReturnType<typeof createClient>>, jobId: string, form: FormData): Promise<string | null> {
  const start = String(form.get("scheduled_start") ?? "");
  const due = String(form.get("scheduled_due") ?? "");
  if (!start && !due) return null;
  const ok = (d: string) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!ok(start) || !ok(due) || (start && due && due < start)) return "the schedule dates were not valid, so they were left blank";
  const { error } = await db.from("service_jobs").update({ scheduled_start: start || null, scheduled_due: due || null }).eq("id", jobId);
  return error ? "the schedule dates could not be saved" : null;
}

const PRIORITIES = ["hot", "normal", "seasonal", "scheduled", "winter_storage"];

/** Opens a service job for a raft that is already on file. */
export async function checkIn(form: FormData) {
  await requireStaff();
  const id = text(form, "id");
  if (!UUID.test(id)) redirect("/rafts");
  const location = text(form, "location_id");
  const priority = text(form, "priority");
  const received = text(form, "date_received");
  if (!UUID.test(location)) back(id, "error", "Choose the shop.");
  if (!PRIORITIES.includes(priority)) back(id, "error", "Choose a priority.");
  if (received && !/^\d{4}-\d{2}-\d{2}$/.test(received)) back(id, "error", "The received date was not understood.");
  const supabase = await createClient();
  const { data: jobId, error } = await supabase.rpc("check_in_asset", {
    p_asset: id,
    p_location: location,
    p_priority: priority,
    p_estimate_required: form.get("estimate_required") === "on",
    p_pickup_location: text(form, "pickup_location"),
    p_dropped_off_by: text(form, "dropped_off_by"),
    p_date_received: received || null,
    p_notes: text(form, "notes"),
  });
  if (error) back(id, "error", error.message);
  const scheduleProblem = await saveSchedule(supabase, jobId as string, form);
  revalidatePath(`/rafts/${id}`);
  back(id, "done", `Checked in. A service job is open at Received${scheduleProblem ? `, but ${scheduleProblem}` : ""}.`);
}
