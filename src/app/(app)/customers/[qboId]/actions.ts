"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { ensureCustomer } from "@/lib/customers";
import { createClient } from "@/lib/supabase/server";

const TYPES = ["seasonal", "full_time", "recreational"];

/** Saves the switches kept in this system for a QuickBooks customer. */
export async function saveCustomerSettings(form: FormData) {
  const staff = await requireStaff();
  const qboId = String(form.get("qbo_id") ?? "");
  if (!/^\d+$/.test(qboId)) redirect("/customers");
  const type = String(form.get("customer_type") ?? "");
  const supabase = await createClient();
  let message = "Customer settings saved.";
  let kind = "done";
  try {
    const id = await ensureCustomer(supabase, qboId);
    const { error } = await supabase
      .from("customers")
      .update({
        customer_type: TYPES.includes(type) ? type : null,
        no_reminders: form.get("no_reminders") === "on",
        partner_account: form.get("partner_account") === "on",
        notes: String(form.get("notes") ?? "").trim().slice(0, 2000) || null,
        // Only an admin can exempt a customer from the unpaid-invoice hold.
        ...(staff.role === "admin" ? { payment_hold_exempt: form.get("payment_hold_exempt") === "on" } : {}),
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
  } catch (err) {
    kind = "error";
    message = err instanceof Error ? err.message : "The settings could not be saved.";
  }
  revalidatePath(`/customers/${qboId}`);
  redirect(`/customers/${qboId}?${kind}=${encodeURIComponent(message)}`);
}
