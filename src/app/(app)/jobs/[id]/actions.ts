"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface PartState {
  ok: boolean;
  message: string | null;
  /** A scanned code the system did not recognise, waiting for someone to pick its part. */
  unknownCode: string | null;
}

type Db = Awaited<ReturnType<typeof createClient>>;

/** The active QuickBooks item for a part number, preferring the one filed under Service Parts. */
async function itemForPartNumber(db: Db, partNumber: string) {
  const { data } = await db
    .from("qbo_items")
    .select("qbo_id, name, fully_qualified_name")
    .eq("active", true)
    .ilike("name", partNumber.replace(/[%_\\]/g, (c) => `\\${c}`))
    .limit(10);
  const rows = data ?? [];
  return rows.find((r) => r.fully_qualified_name.toLowerCase().startsWith("service parts:")) ?? rows[0] ?? null;
}

/** Adds a part from a scanned label or a typed part number. */
export async function addByCode(_prev: PartState, form: FormData): Promise<PartState> {
  await requireStaff();
  const jobId = String(form.get("job_id") ?? "");
  const code = String(form.get("code") ?? "").trim().slice(0, 120);
  if (!UUID.test(jobId) || !code) return { ok: false, message: "Nothing was scanned.", unknownCode: null };

  const supabase = await createClient();
  const { data: known } = await supabase.from("part_codes").select("part_number").eq("code", code).maybeSingle();
  const item = await itemForPartNumber(supabase, known?.part_number ?? code);
  if (!item) {
    return {
      ok: false,
      message: known
        ? `That label is part ${known.part_number}, which is not an active item in QuickBooks.`
        : "That label is not recognised yet. Find the part below and add it; the label will be remembered.",
      unknownCode: known ? null : code,
    };
  }
  const { error } = await supabase.rpc("add_job_line", { p_job: jobId, p_item: item.qbo_id, p_quantity: 1, p_source: "scan" });
  if (error) return { ok: false, message: error.message, unknownCode: null };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: `Added ${item.name}.`, unknownCode: null };
}

/** Adds a part picked from the search list. If a label was waiting to be identified, remembers it. */
export async function addItem(form: FormData) {
  const staff = await requireStaff();
  const jobId = String(form.get("job_id") ?? "");
  const itemId = String(form.get("item_id") ?? "");
  const quantity = Number(String(form.get("quantity") ?? "1"));
  const learn = String(form.get("learn_code") ?? "").trim().slice(0, 120);
  if (!UUID.test(jobId) || !/^\d+$/.test(itemId) || !(quantity > 0 && quantity <= 9999)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_job_line", { p_job: jobId, p_item: itemId, p_quantity: quantity, p_source: "manual" });
  if (!error && learn) {
    const { data: item } = await supabase.from("qbo_items").select("name").eq("qbo_id", itemId).maybeSingle();
    if (item) {
      await supabase
        .from("part_codes")
        .upsert({ code: learn, part_number: item.name, source: "learned", created_by: staff.id }, { onConflict: "code", ignoreDuplicates: true });
    }
  }
  revalidatePath(`/jobs/${jobId}`);
}

export async function setQuantity(form: FormData) {
  await requireStaff();
  const jobId = String(form.get("job_id") ?? "");
  const lineId = String(form.get("line_id") ?? "");
  const quantity = Number(String(form.get("quantity") ?? ""));
  if (!UUID.test(jobId) || !UUID.test(lineId)) return;
  const supabase = await createClient();
  if (quantity > 0 && quantity <= 9999) {
    await supabase.from("job_lines").update({ quantity, updated_at: new Date().toISOString() }).eq("id", lineId).eq("job_id", jobId);
  } else if (quantity === 0) {
    await supabase.from("job_lines").delete().eq("id", lineId).eq("job_id", jobId);
  }
  revalidatePath(`/jobs/${jobId}`);
}

/** Adds the standard service (labor) line and the certificate line, where there are rules for this raft. */
export async function addStandard(form: FormData) {
  await requireStaff();
  const jobId = String(form.get("job_id") ?? "");
  if (!UUID.test(jobId)) return;
  const supabase = await createClient();
  await supabase.rpc("add_standard_service_line", { p_job: jobId });
  await supabase.rpc("add_certificate_line", { p_job: jobId });
  revalidatePath(`/jobs/${jobId}`);
}
