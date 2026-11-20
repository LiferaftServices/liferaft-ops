"use server";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { findOrCreateVessel, resolveOwner, topAccount } from "@/lib/customers";
import { PRIORITY_LABELS, serviceIntervalMonths } from "@/lib/raft-options";
import { createClient } from "@/lib/supabase/server";
import { newSystemId } from "@/lib/system-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim().slice(0, 500);

/** Registers a new raft for a QuickBooks customer and, unless unticked, checks it in. */
export async function registerRaft(form: FormData) {
  await requireStaff();
  const qboId = text(form, "qbo_id");
  if (!/^\d+$/.test(qboId)) redirect("/intake");
  const fail = (message: string): never =>
    redirect(`/intake/${qboId}?error=${encodeURIComponent(message)}&serial=${encodeURIComponent(text(form, "serial_number"))}`);

  const serial = text(form, "serial_number");
  const brand = text(form, "brand");
  const type = text(form, "equipment_type");
  const capacity = text(form, "capacity");
  const made = text(form, "manufacture_month"); // YYYY-MM
  const location = text(form, "location_id");
  const priority = text(form, "priority") || "normal";
  if (!serial) fail("Enter the serial number.");
  if (!brand || !type) fail("Choose the brand and type.");
  if (!/^\d{1,3}$/.test(capacity)) fail("Enter the capacity as a number of persons.");
  if (made && !/^\d{4}-\d{2}$/.test(made)) fail("The manufacture date was not understood.");
  if (!UUID.test(location)) fail("Choose the shop.");
  if (!(priority in PRIORITY_LABELS)) fail("Choose a priority.");

  const supabase = await createClient();
  let assetId = "";
  try {
    const owner = await resolveOwner(supabase, qboId);
    let vesselId = owner.vesselId;
    const typed = text(form, "new_vessel");
    const chosen = text(form, "vessel_id");
    if (typed) vesselId = await findOrCreateVessel(supabase, await topAccount(supabase, owner.customerId), typed);
    else if (UUID.test(chosen)) vesselId = chosen;

    const { data, error } = await supabase.rpc("register_raft", {
      p_customer: owner.customerId,
      p_vessel: vesselId,
      p_system_id: newSystemId(),
      p_serial: serial,
      p_brand: brand,
      p_model: text(form, "model"),
      p_capacity: Number(capacity),
      p_equipment_type: type,
      // Manufacture dates are recorded to the month; the 1st stands for "that month".
      p_manufacture_date: made ? `${made}-01` : null,
      p_interval_months: serviceIntervalMonths(type, brand),
      p_location: location,
    });
    if (error) throw new Error(error.message);
    assetId = data as string;

    if (form.get("check_in") === "on") {
      const { error: jobError } = await supabase.rpc("check_in_asset", {
        p_asset: assetId,
        p_location: location,
        p_priority: priority,
        p_estimate_required: form.get("estimate_required") === "on",
        p_pickup_location: text(form, "pickup_location"),
        p_dropped_off_by: text(form, "dropped_off_by"),
        p_date_received: text(form, "date_received") || null,
        p_notes: text(form, "notes"),
      });
      if (jobError) {
        redirect(
          `/rafts/${assetId}?error=${encodeURIComponent(`The raft was registered, but check-in failed: ${jobError.message}`)}`,
        );
      }
    }
  } catch (err) {
    // redirect() works by throwing; let it through.
    if (err && typeof err === "object" && "digest" in err) throw err;
    fail(err instanceof Error ? err.message : "Could not register the raft.");
  }
  const message =
    form.get("check_in") === "on" ? "Raft registered and checked in at Received." : "Raft registered.";
  redirect(`/rafts/${assetId}?done=${encodeURIComponent(message)}`);
}
