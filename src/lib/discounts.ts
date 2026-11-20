import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

/** The discount items in QuickBooks: every active item with "discount" in its name. */
export async function discountItems(db: Db) {
  const { data } = await db
    .from("qbo_items")
    .select("qbo_id, name, description, taxable")
    .eq("active", true)
    .ilike("name", "%discount%")
    .order("name");
  return data ?? [];
}
