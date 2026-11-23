"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { PHOTO_BUCKET, PHOTO_KINDS } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_BYTES = 5 * 1024 * 1024;

/** Stores one photo for a job. The browser shrinks the picture before it is sent. */
export async function addPhoto(form: FormData): Promise<{ ok: boolean; message: string }> {
  const staff = await requireStaff();
  const jobId = String(form.get("job_id") ?? "");
  const kind = String(form.get("kind") ?? "");
  const file = form.get("photo");
  if (!UUID.test(jobId) || !(kind in PHOTO_KINDS)) return { ok: false, message: "That photo could not be saved." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose or take a photo first." };
  if (file.size > MAX_BYTES) return { ok: false, message: "That photo is too large." };
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return { ok: false, message: "Only photos can be added here." };

  const supabase = await createClient();
  const { data: job } = await supabase.from("service_jobs").select("id, asset_id").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, message: "That job no longer exists." };
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${job.asset_id}/${jobId}/${kind}-${crypto.randomUUID()}.${ext}`;
  const { error: upError } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upError) return { ok: false, message: `The photo was not saved: ${upError.message}` };
  const { error } = await supabase.from("job_photos").insert({ job_id: jobId, asset_id: job.asset_id, kind, path, created_by: staff.id });
  if (error) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    return { ok: false, message: `The photo was not saved: ${error.message}` };
  }
  revalidatePath(`/jobs/${jobId}/inspection`);
  revalidatePath(`/rafts/${job.asset_id}`);
  return { ok: true, message: "" };
}

/** Removes a photo added by mistake. */
export async function removePhoto(form: FormData) {
  await requireStaff();
  const id = String(form.get("photo_id") ?? "");
  if (!UUID.test(id)) return;
  const supabase = await createClient();
  const { data: photo } = await supabase.from("job_photos").select("path, job_id, asset_id").eq("id", id).maybeSingle();
  if (!photo) return;
  const { error } = await supabase.from("job_photos").delete().eq("id", id);
  if (!error) await supabase.storage.from(PHOTO_BUCKET).remove([photo.path]);
  revalidatePath(`/jobs/${photo.job_id}/inspection`);
  revalidatePath(`/rafts/${photo.asset_id}`);
}
