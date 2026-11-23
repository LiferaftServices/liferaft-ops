"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIRECTIONS = ["north", "south"];
const KINDS = ["deliver", "pickup", "equipment", "transfer", "loaner", "other"];

const text = (form: FormData, key: string, max = 300) => String(form.get(key) ?? "").trim().slice(0, max);
function back(form: FormData, kind: "done" | "error", message: string): never {
  const asked = text(form, "return_to", 200);
  const base = asked.startsWith("/deliveries") && !asked.includes("//") ? asked : "/deliveries";
  revalidatePath("/deliveries", "layout");
  redirect(`${base}${base.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

type Db = Awaited<ReturnType<typeof createClient>>;

async function ensureRoute(db: Db, direction: string, week: string): Promise<string> {
  const { data: found } = await db.from("routes").select("id").eq("direction", direction).eq("week_start", week).eq("name", "main").maybeSingle();
  if (found) return found.id;
  const { data, error } = await db.from("routes").insert({ direction, week_start: week, name: "main" }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** Turns a day choice ("day:<id>", "date:<yyyy-mm-dd>" or "") into a delivery day, creating one for a bare date. */
async function resolveDay(db: Db, routeId: string, choice: string, staffId: string): Promise<{ id: string; day: string } | null> {
  if (choice.startsWith("day:") && UUID.test(choice.slice(4))) {
    const { data } = await db.from("route_days").select("id, day").eq("id", choice.slice(4)).eq("route_id", routeId).maybeSingle();
    return data ?? null;
  }
  if (choice.startsWith("date:") && DATE.test(choice.slice(5))) {
    const day = choice.slice(5);
    const { data: existing } = await db.from("route_days").select("id, day").eq("route_id", routeId).eq("day", day).order("created_at").limit(1).maybeSingle();
    if (existing) return existing;
    const { data, error } = await db.from("route_days").insert({ route_id: routeId, day, created_by: staffId }).select("id, day").single();
    if (error) throw new Error(error.message);
    return data;
  }
  return null;
}

/** Adds a delivery day: a truck going out on a date, with an optional note such as who is driving. */
export async function addDay(form: FormData) {
  const staff = await requireStaff();
  const week = text(form, "week");
  const direction = text(form, "direction");
  const day = text(form, "day");
  if (!DATE.test(week) || !DIRECTIONS.includes(direction) || !DATE.test(day)) back(form, "error", "Choose a date for the day.");
  const supabase = await createClient();
  try {
    const routeId = await ensureRoute(supabase, direction, week);
    const { error } = await supabase.from("route_days").insert({ route_id: routeId, day, note: text(form, "note", 120) || null, created_by: staff.id });
    if (error) throw new Error(error.message);
  } catch (err) {
    back(form, "error", err instanceof Error ? err.message : "The day could not be added.");
  }
  back(form, "done", "Day added.");
}

/** Changes a day's note, or removes a day that has no stops. */
export async function updateDay(form: FormData) {
  await requireStaff();
  const id = text(form, "day_id");
  if (!UUID.test(id)) back(form, "error", "That day was not found.");
  const supabase = await createClient();
  if (form.get("remove") === "1") {
    const { count } = await supabase.from("route_stops").select("id", { count: "exact", head: true }).eq("day_id", id);
    if (count) back(form, "error", "Move or remove the stops on this day first.");
    const { error } = await supabase.from("route_days").delete().eq("id", id);
    if (error) back(form, "error", error.message);
    form.set("return_to", "/deliveries");
    back(form, "done", "Day removed.");
  }
  const { error } = await supabase.from("route_days").update({ note: text(form, "note", 120) || null }).eq("id", id);
  if (error) back(form, "error", error.message);
  back(form, "done", "Note saved.");
}

/** Saves the driving order of the stops in a day. */
export async function reorderStops(ids: string[]): Promise<void> {
  await requireStaff();
  if (!Array.isArray(ids) || ids.length > 200 || !ids.every((i) => typeof i === "string" && UUID.test(i))) return;
  const supabase = await createClient();
  await Promise.all(ids.map((id, i) => supabase.from("route_stops").update({ position: i + 1 }).eq("id", id)));
  revalidatePath("/deliveries", "layout");
}

/** Adds a stop (a place on a day) to a week's run, creating the run if this is its first stop. */
export async function addStop(form: FormData) {
  const staff = await requireStaff();
  const week = text(form, "week");
  const direction = text(form, "direction");
  const title = text(form, "title", 120);
  if (!DATE.test(week) || !DIRECTIONS.includes(direction)) back(form, "error", "That run was not recognised.");
  if (!title) back(form, "error", "Give the stop a name, such as the yard, dock or customer.");
  const supabase = await createClient();
  let routeId = "";
  let chosen: { id: string; day: string } | null = null;
  try {
    routeId = await ensureRoute(supabase, direction, week);
    chosen = await resolveDay(supabase, routeId, text(form, "day"), staff.id);
  } catch (err) {
    back(form, "error", err instanceof Error ? err.message : "The stop could not be added.");
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
    route_id: routeId,
    day_id: chosen?.id ?? null,
    stop_date: chosen?.day ?? null,
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
  // A stop is complete when everything on it is ticked, and reopens if something is unticked.
  const { data: item } = await supabase.from("stop_items").select("stop_id").eq("id", id).maybeSingle();
  if (item) {
    const { data: rest } = await supabase.from("stop_items").select("done_at").eq("stop_id", item.stop_id);
    const all = (rest ?? []).length > 0 && (rest ?? []).every((r) => r.done_at);
    await supabase
      .from("route_stops")
      .update(all ? { completed_at: new Date().toISOString(), completed_by: staff.id } : { completed_at: null, completed_by: null })
      .eq("id", item.stop_id);
    if (all) back(form, "done", "Stop complete.");
  }
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
  else await supabase.from("stop_items").update({ done_at: null, done_by: null }).eq("stop_id", id);
  back(form, "done", done ? "Stop completed." : "Stop reopened.");
}

/** Moves a stop to another day, or changes its details. */
export async function updateStop(form: FormData) {
  const staff = await requireStaff();
  const id = text(form, "stop_id");
  if (!UUID.test(id)) back(form, "error", "That change was not understood.");
  const supabase = await createClient();
  const { data: stop } = await supabase.from("route_stops").select("route_id, day_id").eq("id", id).maybeSingle();
  if (!stop) back(form, "error", "That stop was not found.");
  let chosen: { id: string; day: string } | null = null;
  try {
    chosen = await resolveDay(supabase, stop!.route_id, text(form, "day"), staff.id);
  } catch (err) {
    back(form, "error", err instanceof Error ? err.message : "The day could not be set.");
  }
  const moved = (chosen?.id ?? null) !== stop!.day_id;
  const { error } = await supabase
    .from("route_stops")
    .update({
      day_id: chosen?.id ?? null,
      stop_date: chosen?.day ?? null,
      ...(moved ? { position: null } : {}), // goes to the end of its new day
      address: text(form, "address") || null,
      contact_name: text(form, "contact_name", 120) || null,
      contact_phone: text(form, "contact_phone", 40) || null,
      call_ahead: text(form, "call_ahead", 120) || null,
      notes: text(form, "notes", 1000) || null,
    })
    .eq("id", id);
  if (error) back(form, "error", error.message);
  if (moved && text(form, "return_to").startsWith("/deliveries/day/")) form.set("return_to", text(form, "return_to"));
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
