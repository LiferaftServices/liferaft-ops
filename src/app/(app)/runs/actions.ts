"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIRECTIONS = ["north", "south", "special"];
const KINDS = ["deliver", "pickup", "equipment", "transfer", "loaner", "other"];

const text = (form: FormData, key: string, max = 300) => String(form.get(key) ?? "").trim().slice(0, max);
function back(form: FormData, kind: "done" | "error", message: string): never {
  const week = DATE.test(text(form, "week")) ? text(form, "week") : "";
  const raft = UUID.test(text(form, "raft")) ? `&raft=${text(form, "raft")}` : "";
  revalidatePath("/runs");
  redirect(`/runs?week=${week}${raft}&${kind}=${encodeURIComponent(message)}`);
}

/** Adds a stop (a place on a day) to a week's run, creating the run if this is its first stop. */
export async function addStop(form: FormData) {
  const staff = await requireStaff();
  const week = text(form, "week");
  const direction = text(form, "direction");
  const day = text(form, "stop_date");
  const title = text(form, "title", 120);
  if (!DATE.test(week) || !DIRECTIONS.includes(direction)) back(form, "error", "That run was not recognised.");
  if (!title) back(form, "error", "Give the stop a name, such as the yard, dock or customer.");
  if (day && !DATE.test(day)) back(form, "error", "The day was not understood.");
  const supabase = await createClient();
  let { data: route } = await supabase.from("routes").select("id").eq("direction", direction).eq("week_start", week).eq("name", "main").maybeSingle();
  if (!route) {
    const created = await supabase.from("routes").insert({ direction, week_start: week, name: "main" }).select("id").single();
    if (created.error) back(form, "error", created.error.message);
    route = created.data;
  }
  let address = text(form, "address");
  let phone = text(form, "contact_phone", 40);
  if (!address) {
    // A place used before: fill in what was saved for it.
    const { data: place } = await supabase.from("saved_places").select("address, contact_phone").ilike("name", title).limit(1).maybeSingle();
    address = place?.address ?? "";
    phone = phone || (place?.contact_phone ?? "");
  }
  const { error } = await supabase.from("route_stops").insert({
    route_id: route!.id,
    stop_date: day || null,
    title,
    address: address || null,
    contact_name: text(form, "contact_name", 120) || null,
    contact_phone: phone || null,
    call_ahead: text(form, "call_ahead", 120) || null,
    notes: text(form, "notes", 1000) || null,
    created_by: staff.id,
  });
  if (error) back(form, "error", error.message);
  // Remember the place so it can be picked next time.
  if (form.get("remember") === "on" && address) {
    await supabase.from("saved_places").upsert({ name: title, address, contact_phone: phone || null }, { onConflict: "name", ignoreDuplicates: true });
  }
  back(form, "done", `Stop added: ${title}.`);
}

/** Adds one thing to do at a stop. A serial number ties it to the raft and its open job. */
export async function addItem(form: FormData) {
  const staff = await requireStaff();
  const stopId = text(form, "stop_id");
  const kind = text(form, "kind");
  const serial = text(form, "serial", 60);
  let description = text(form, "description");
  if (!UUID.test(stopId) || !KINDS.includes(kind)) back(form, "error", "That could not be added.");
  const supabase = await createClient();
  let assetId: string | null = null;
  let jobId: string | null = null;
  if (serial) {
    const { data: found } = await supabase.rpc("find_assets_by_serial", { p_serial: serial });
    const rafts = Array.isArray(found) ? found : [];
    if (rafts.length !== 1) {
      back(form, "error", rafts.length ? `More than one raft matches ${serial}. Add it from the raft's own page.` : `No raft matches ${serial}. Check the serial, or leave it blank and describe the item.`);
    }
    const r = rafts[0] as { id: string; serial_number: string | null; brand: string | null; capacity: number | null; customer_name: string | null; vessel_name: string | null };
    assetId = r.id;
    const { data: job } = await supabase.from("service_jobs").select("id").eq("asset_id", r.id).is("closed_at", null).maybeSingle();
    jobId = job?.id ?? null;
    const label = [r.serial_number, [r.brand, r.capacity ? `${r.capacity}p` : null].filter(Boolean).join(" "), r.customer_name, r.vessel_name].filter(Boolean).join(" · ");
    description = description ? `${label} · ${description}` : label;
  }
  if (!description) back(form, "error", "Enter a raft serial number or describe the item.");
  const { error } = await supabase.from("stop_items").insert({ stop_id: stopId, kind, job_id: jobId, asset_id: assetId, description, created_by: staff.id });
  if (error) back(form, "error", error.message);
  back(form, "done", "Added to the stop.");
}

/** Ticks one item off, or unticks it. */
export async function toggleItem(form: FormData) {
  const staff = await requireStaff();
  const id = text(form, "item_id");
  if (!UUID.test(id)) back(form, "error", "That item was not found.");
  const supabase = await createClient();
  const done = form.get("done") === "1";
  const { error } = await supabase
    .from("stop_items")
    .update(done ? { done_at: new Date().toISOString(), done_by: staff.id } : { done_at: null, done_by: null })
    .eq("id", id);
  if (error) back(form, "error", error.message);
  back(form, "done", done ? "Marked done." : "Marked not done.");
}

/** Marks a whole stop complete (ticking every item on it), or reopens it. */
export async function toggleStop(form: FormData) {
  const staff = await requireStaff();
  const id = text(form, "stop_id");
  if (!UUID.test(id)) back(form, "error", "That stop was not found.");
  const supabase = await createClient();
  const done = form.get("done") === "1";
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("route_stops")
    .update(done ? { completed_at: now, completed_by: staff.id } : { completed_at: null, completed_by: null })
    .eq("id", id);
  if (error) back(form, "error", error.message);
  if (done) await supabase.from("stop_items").update({ done_at: now, done_by: staff.id }).eq("stop_id", id).is("done_at", null);
  back(form, "done", done ? "Stop completed." : "Stop reopened.");
}

/** Moves a stop to another day, or changes its details. */
export async function updateStop(form: FormData) {
  await requireStaff();
  const id = text(form, "stop_id");
  const day = text(form, "stop_date");
  if (!UUID.test(id) || (day && !DATE.test(day))) back(form, "error", "That change was not understood.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("route_stops")
    .update({
      stop_date: day || null,
      position: Number(text(form, "position")) || null,
      address: text(form, "address") || null,
      contact_name: text(form, "contact_name", 120) || null,
      contact_phone: text(form, "contact_phone", 40) || null,
      call_ahead: text(form, "call_ahead", 120) || null,
      notes: text(form, "notes", 1000) || null,
    })
    .eq("id", id);
  if (error) back(form, "error", error.message);
  back(form, "done", "Stop updated.");
}

/** Removes an item, or an empty stop. */
export async function removeFromRun(form: FormData) {
  await requireStaff();
  const itemId = text(form, "item_id");
  const stopId = text(form, "stop_id");
  const supabase = await createClient();
  if (UUID.test(itemId)) {
    const { error } = await supabase.from("stop_items").delete().eq("id", itemId);
    if (error) back(form, "error", error.message);
    back(form, "done", "Removed.");
  }
  if (UUID.test(stopId)) {
    const { count } = await supabase.from("stop_items").select("id", { count: "exact", head: true }).eq("stop_id", stopId);
    if (count) back(form, "error", "Remove the items on this stop first.");
    const { error } = await supabase.from("route_stops").delete().eq("id", stopId);
    if (error) back(form, "error", error.message);
    back(form, "done", "Stop removed.");
  }
  back(form, "error", "Nothing was removed.");
}
