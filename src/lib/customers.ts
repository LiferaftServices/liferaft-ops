import "server-only";
import type { createClient } from "@/lib/supabase/server";

// Shared steps for tying rafts to customers and vessels.

export type Db = Awaited<ReturnType<typeof createClient>>;

export const VESSEL_PREFIX = /^\s*(f\/v|m\/v|s\/v|t\/v|r\/v|p\/v|s\/y|m\/y|tug|yacht)[\s.:/-]+/i;

/** The local customer record for a QuickBooks customer, created (with its parents) if needed. */
export async function ensureCustomer(db: Db, qboId: string, depth = 0): Promise<string> {
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
export async function topAccount(db: Db, customerId: string): Promise<string> {
  let id = customerId;
  for (let i = 0; i < 6; i += 1) {
    const { data } = await db.from("customers").select("parent_id").eq("id", id).maybeSingle();
    if (!data?.parent_id) return id;
    id = data.parent_id;
  }
  return id;
}

/** "F/V Reel Action", "Reel Action" and "reel  action" are the same vessel. */
export const vesselKey = (name: string) => name.replace(VESSEL_PREFIX, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export async function findOrCreateVessel(db: Db, accountId: string, name: string): Promise<string> {
  const { data: existing } = await db.from("vessels").select("id, name").eq("customer_id", accountId).limit(1000);
  const key = vesselKey(name);
  const match = key ? (existing ?? []).find((v) => vesselKey(v.name) === key) : undefined;
  if (match) return match.id;
  const { data, error } = await db.from("vessels").insert({ customer_id: accountId, name }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}


/**
 * Works out who owns an asset when a QuickBooks record is chosen. If the record is
 * really a vessel under a customer (already linked, or named like "F/V ..." under a
 * parent), the owner is the parent and the record becomes the vessel.
 */
export async function resolveOwner(
  db: Db,
  qboId: string,
): Promise<{ customerId: string; vesselId: string | null }> {
  const { data: asVessel } = await db
    .from("vessels")
    .select("id, customer_id")
    .eq("qbo_customer_id", qboId)
    .maybeSingle();
  if (asVessel) return { customerId: asVessel.customer_id, vesselId: asVessel.id };
  const { data: q } = await db
    .from("qbo_customers")
    .select("display_name, fully_qualified_name, parent_qbo_id")
    .eq("qbo_id", qboId)
    .maybeSingle();
  if (q?.parent_qbo_id && VESSEL_PREFIX.test(q.display_name)) {
    const customerId = await ensureCustomer(db, q.parent_qbo_id);
    const account = await topAccount(db, customerId);
    const { data: v, error } = await db
      .from("vessels")
      .insert({ customer_id: account, name: q.display_name, qbo_customer_id: qboId, qbo_full_name: q.fully_qualified_name })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { customerId, vesselId: v.id };
  }
  return { customerId: await ensureCustomer(db, qboId), vesselId: null };
}
