"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VESSEL_PREFIX = /^\s*(f\/v|m\/v|s\/v|t\/v|r\/v|p\/v|s\/y|m\/y|tug|yacht)[\s.:/-]+/i;

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
      capacity: capacity ? Number(capacity) : null,
      equipment_type: orNull(text(form, "equipment_type")),
      manufacture_date: orNull(text(form, "manufacture_date")),
      service_interval_months: interval ? Number(interval) : null,
      next_service_due: orNull(text(form, "next_service_due")),
      is_loaner: form.get("is_loaner") === "on",
      lapsed: form.get("lapsed") === "on",
      confirmed: true, // a person has now looked at and saved these details
    })
    .eq("id", id);
  if (error) back(id, "error", `Could not save: ${error.message}`);
  revalidatePath(`/rafts/${id}`);
  back(id, "done", "Details saved.");
}

/** The local customer record for a QuickBooks customer, created (with its parents) if needed. */
async function ensureCustomer(db: Db, qboId: string, depth = 0): Promise<string> {
  const existing = await db.from("customers").select("id").eq("qbo_customer_id", qboId).maybeSingle();
  if (existing.data) return existing.data.id;
  const { data: q } = await db
    .from("qbo_customers")
    .select("qbo_id, parent_qbo_id, display_name, fully_qualified_name, company_name, phone, mobile, email, active")
    .eq("qbo_id", qboId)
    .maybeSingle();
  if (!q) throw new Error("That customer is not in the QuickBooks copy. Copy customers again and retry.");
  if (!q.active) throw new Error("That QuickBooks customer is inactive or was merged into another record.");
  const parentId = q.parent_qbo_id && depth < 5 ? await ensureCustomer(db, q.parent_qbo_id, depth + 1) : null;
  const { data, error } = await db
    .from("customers")
    .insert({
      qbo_customer_id: q.qbo_id,
      qbo_full_name: q.fully_qualified_name,
      parent_id: parentId,
      name: q.display_name,
      kind: q.company_name ? "company" : "individual",
      phone: q.phone ?? q.mobile,
      email: q.email,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** The top-level account above a customer: vessels are always kept there. */
async function topAccount(db: Db, customerId: string): Promise<string> {
  let id = customerId;
  for (let i = 0; i < 6; i += 1) {
    const { data } = await db.from("customers").select("parent_id").eq("id", id).maybeSingle();
    if (!data?.parent_id) return id;
    id = data.parent_id;
  }
  return id;
}

/** "F/V Reel Action", "Reel Action" and "reel  action" are the same vessel. */
const vesselKey = (name: string) => name.replace(VESSEL_PREFIX, "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function findOrCreateVessel(db: Db, accountId: string, name: string): Promise<string> {
  const { data: existing } = await db.from("vessels").select("id, name").eq("customer_id", accountId).limit(1000);
  const key = vesselKey(name);
  const match = key ? (existing ?? []).find((v) => vesselKey(v.name) === key) : undefined;
  if (match) return match.id;
  const { data, error } = await db.from("vessels").insert({ customer_id: accountId, name }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
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
    // If the chosen QuickBooks record is really a vessel under a customer, treat it as one.
    const { data: asVessel } = await supabase
      .from("vessels")
      .select("id, customer_id")
      .eq("qbo_customer_id", qboId)
      .maybeSingle();
    let customerId: string;
    let vesselId: string | null = null;
    if (asVessel) {
      customerId = asVessel.customer_id;
      vesselId = asVessel.id;
    } else {
      const { data: q } = await supabase
        .from("qbo_customers")
        .select("display_name, fully_qualified_name, parent_qbo_id")
        .eq("qbo_id", qboId)
        .maybeSingle();
      if (q?.parent_qbo_id && VESSEL_PREFIX.test(q.display_name)) {
        customerId = await ensureCustomer(supabase, q.parent_qbo_id);
        const account = await topAccount(supabase, customerId);
        const { data: v, error } = await supabase
          .from("vessels")
          .insert({
            customer_id: account,
            name: q.display_name,
            qbo_customer_id: qboId,
            qbo_full_name: q.fully_qualified_name,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        vesselId = v.id;
      } else {
        customerId = await ensureCustomer(supabase, qboId);
      }
    }
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
