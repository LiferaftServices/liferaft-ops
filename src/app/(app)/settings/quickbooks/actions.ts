"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { syncCustomers, syncItems } from "@/lib/qbo/client";
import { qboConfig } from "@/lib/qbo/config";
import { revokeToken } from "@/lib/qbo/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

export interface ActionState {
  message: string | null;
  ok: boolean;
}

/** Copies the customer list from QuickBooks. Reads only; changes nothing there. */
export async function runCustomerSync(): Promise<ActionState> {
  await requireStaff();
  try {
    const count = await syncCustomers();
    revalidatePath("/settings/quickbooks");
    revalidatePath("/customers");
    return { ok: true, message: `Copied ${count.toLocaleString("en-US")} customers from QuickBooks.` };
  } catch (err) {
    // Refresh the page too: if the sign-in expired, it now shows the Connect button.
    revalidatePath("/settings/quickbooks");
    return { ok: false, message: err instanceof Error ? err.message : "The sync failed." };
  }
}

export async function disconnectQuickBooks(): Promise<ActionState> {
  const staff = await requireStaff();
  if (staff.role !== "admin") return { ok: false, message: "Only an admin can disconnect QuickBooks." };
  const db = createAdminClient();
  const { data } = await db.from("qbo_connection").select("refresh_token").maybeSingle();
  if (data) {
    await revokeToken(qboConfig(), data.refresh_token).catch(() => undefined);
    const { error } = await db.from("qbo_connection").delete().eq("id", true);
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath("/settings/quickbooks");
  return { ok: true, message: "QuickBooks is disconnected. The copied customer list is kept." };
}

/** Copies the products and services list from QuickBooks. Reads only. */
export async function runItemSync(): Promise<ActionState> {
  await requireStaff();
  try {
    const count = await syncItems();
    revalidatePath("/settings/quickbooks");
    return { ok: true, message: `Copied ${count.toLocaleString("en-US")} products and services from QuickBooks.` };
  } catch (err) {
    revalidatePath("/settings/quickbooks");
    return { ok: false, message: err instanceof Error ? err.message : "The item copy failed." };
  }
}
