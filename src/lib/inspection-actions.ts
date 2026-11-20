"use server";

import { requireStaff } from "@/lib/auth";
import { cleanValue, FIELDS } from "@/lib/inspection-form";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Saves one inspection field for one job. Other fields, and other people's edits, are untouched. */
export async function saveField(jobId: string, key: string, raw: string): Promise<{ ok: boolean; message: string }> {
  await requireStaff();
  const field = typeof key === "string" ? FIELDS.get(key) : undefined;
  if (!UUID.test(String(jobId)) || !field || typeof raw !== "string") return { ok: false, message: "That field could not be saved." };
  const value = cleanValue(field, raw);
  if (value === undefined) return { ok: false, message: `"${raw}" is not valid for ${field.label}.` };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_inspection_fields", { p_job: jobId, p_patch: { [key]: value } });
  return error ? { ok: false, message: error.message } : { ok: true, message: "" };
}
