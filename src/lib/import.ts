import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Loads a prepared import file (owners, vessels, assets, ownership, service history).
// Every row carries a fixed id, so loading the same file twice changes nothing.

const BATCH = 500;
type Row = Record<string, unknown>;

export interface ImportFile {
  version: number;
  customers?: Row[];
  vessels?: Row[];
  assets?: Row[];
  assignments?: Row[];
  history?: Row[];
  part_codes?: Row[];
  /** Approval numbers from past inspections, by asset id. Never overwrites one already entered. */
  approval_numbers?: Row[];
  /** Corrections to assets already loaded: service dates, and records to retire. */
  asset_corrections?: Row[];
  /** Replace the imported service history with the history in this file. */
  replace_history?: boolean;
  /** Assets whose imported ownership should be replaced by the assignments in this file. */
  reset_assignment_assets?: string[];
}

export interface ImportResult {
  customers: number;
  vessels: number;
  assets: number;
  assignments: number;
  history: number;
  part_codes: number;
  approval_numbers: number;
  assets_corrected: number;
  ownership_replaced: number;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function pick(row: Row, keys: readonly string[]): Row {
  const out: Row = {};
  for (const k of keys) if (k in row) out[k] = row[k] ?? null;
  return out;
}

const CUSTOMER = ["id", "qbo_customer_id", "qbo_full_name", "parent_id", "name", "kind", "phone", "email", "notes"] as const;
const VESSEL = ["id", "customer_id", "name", "qbo_customer_id", "qbo_full_name", "confirmed"] as const;
const ASSET = [
  "id", "system_id", "asset_type", "brand", "model", "serial_number", "capacity", "equipment_type",
  "manufacture_date", "item_count", "service_interval_months", "next_service_due", "last_serviced_on",
  "is_loaner", "retired", "retired_reason", "confirmed", "lapsed", "attributes",
] as const;
const ASSIGNMENT = [
  "id", "asset_id", "customer_id", "vessel_id", "effective_from", "effective_to", "reason",
  "qbo_customer_id", "qbo_full_name",
] as const;
const HISTORY = ["id", "asset_id", "serviced_on", "source", "reference", "customer_name", "vessel_name", "details"] as const;

export async function runImport(file: ImportFile): Promise<ImportResult> {
  if (file.version !== 1) throw new Error("This import file is not a version this system understands.");
  const db = createAdminClient();

  const { data: locations, error: locError } = await db.from("locations").select("id, code");
  if (locError) throw new Error(locError.message);
  const locationId = (code: unknown) =>
    typeof code === "string" ? (locations?.find((l) => l.code === code)?.id ?? null) : null;

  async function load(table: string, rows: Row[], ignoreExisting = false): Promise<number> {
    for (const row of rows) {
      if (typeof row.id !== "string" || !ID.test(row.id)) throw new Error(`A ${table} row has no valid id.`);
    }
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await db
        .from(table)
        .upsert(rows.slice(i, i + BATCH), { onConflict: "id", ignoreDuplicates: ignoreExisting });
      if (error) throw new Error(`Loading ${table} failed at row ${i + 1}: ${error.message}`);
    }
    return rows.length;
  }

  // A QuickBooks customer or vessel may already be in the system under a different id
  // (added at intake, or by reassigning a raft). Use the record that is there, and point
  // everything in this file at it, instead of creating a second one.
  async function existingByQbo(table: "customers" | "vessels", rows: Row[]): Promise<Map<string, string>> {
    const remap = new Map<string, string>();
    const byQbo = new Map<string, string>();
    for (const r of rows) if (typeof r.qbo_customer_id === "string") byQbo.set(r.qbo_customer_id, String(r.id));
    const qboIds = [...byQbo.keys()];
    for (let i = 0; i < qboIds.length; i += 200) {
      const { data, error } = await db.from(table).select("id, qbo_customer_id").in("qbo_customer_id", qboIds.slice(i, i + 200));
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        const fileId = byQbo.get(row.qbo_customer_id);
        if (fileId && fileId !== row.id) remap.set(fileId, row.id);
      }
    }
    return remap;
  }
  const swap = (map: Map<string, string>, value: unknown) =>
    typeof value === "string" && map.has(value) ? map.get(value)! : value;

  // Order matters: each table refers to the ones before it. Customers arrive parents-first.
  const customerRows = (file.customers ?? []).map((r) => pick(r, CUSTOMER));
  const customerMap = await existingByQbo("customers", customerRows);
  const customers = await load(
    "customers",
    customerRows
      .filter((r) => !customerMap.has(String(r.id)))
      .map((r) => ({ ...r, parent_id: swap(customerMap, r.parent_id) })),
  );
  const vesselRows: Row[] = (file.vessels ?? []).map((r) => ({ ...pick(r, VESSEL), customer_id: swap(customerMap, r.customer_id) }));
  const vesselMap = await existingByQbo("vessels", vesselRows);
  const vessels = await load("vessels", vesselRows.filter((r) => !vesselMap.has(String(r.id))));
  // An asset that already exists keeps its label id and any edits made since: skip, never overwrite.
  const assets = await load(
    "assets",
    (file.assets ?? []).map((r) => ({ ...pick(r, ASSET), home_location_id: locationId(r.home_location_code) })),
    true,
  );
  // Corrections to assets that are already loaded.
  let assetsCorrected = 0;
  const CORRECTION = ["id", "last_serviced_on", "next_service_due", "lapsed", "retired", "retired_reason"] as const;
  const corrections = (file.asset_corrections ?? []).map((r) => pick(r, CORRECTION));
  for (let i = 0; i < corrections.length; i += BATCH) {
    const { data, error } = await db.rpc("import_apply_asset_corrections", { p: corrections.slice(i, i + BATCH) });
    if (error) throw new Error(`Correcting assets failed: ${error.message}`);
    assetsCorrected += Number(data ?? 0);
  }

  // Where ownership is being corrected, the old imported records for those assets go
  // first. Assets a person has since reassigned are skipped and keep what they have.
  let resetIds: Set<string> | null = null;
  const toReset = (file.reset_assignment_assets ?? []).filter((id) => typeof id === "string" && ID.test(id));
  if (toReset.length) {
    const { data, error } = await db.rpc("import_reset_assignments", { p: toReset });
    if (error) throw new Error(`Replacing ownership failed: ${error.message}`);
    resetIds = new Set((data as string[] | null) ?? []);
  }

  // Past ownership first, so the single "current owner" row per asset never collides.
  const assignmentRows: Row[] = (file.assignments ?? [])
    .map((r) => pick(r, ASSIGNMENT))
    .map((r): Row => ({ ...r, customer_id: swap(customerMap, r.customer_id), vessel_id: swap(vesselMap, r.vessel_id) }))
    .filter((r) => (file.reset_assignment_assets ? resetIds?.has(String(r.asset_id)) : true));
  const assignments =
    (await load("asset_assignments", assignmentRows.filter((r) => r.effective_to !== null), true)) +
    (await load("asset_assignments", assignmentRows.filter((r) => r.effective_to === null), true));
  if (file.replace_history) {
    const { error } = await db.rpc("import_clear_history");
    if (error) throw new Error(`Clearing the old service history failed: ${error.message}`);
  }
  const history = await load(
    "service_history",
    (file.history ?? []).map((r) => ({ ...pick(r, HISTORY), location_id: locationId(r.location_code) })),
    true,
  );
  // Scan codes are keyed by the code itself. A corrected file replaces an earlier mapping.
  const codes = (file.part_codes ?? [])
    .filter((r) => typeof r.code === "string" && typeof r.part_number === "string" && r.code && r.part_number)
    .map((r) => ({ code: String(r.code).trim(), part_number: String(r.part_number).trim(), source: "import" }));
  for (let i = 0; i < codes.length; i += BATCH) {
    const { error } = await db.from("part_codes").upsert(codes.slice(i, i + BATCH), { onConflict: "code" });
    if (error) throw new Error(`Loading scan codes failed: ${error.message}`);
  }
  const approvals = (file.approval_numbers ?? [])
    .filter((r) => typeof r.id === "string" && ID.test(r.id) && typeof r.approval_number === "string" && r.approval_number)
    .map((r) => ({ id: r.id, approval_number: String(r.approval_number).trim().slice(0, 40) }));
  let approvalsSet = 0;
  for (let i = 0; i < approvals.length; i += BATCH) {
    const { data, error } = await db.rpc("import_set_approval_numbers", { p: approvals.slice(i, i + BATCH) });
    if (error) throw new Error(`Loading approval numbers failed: ${error.message}`);
    approvalsSet += Number(data ?? 0);
  }
  return {
    customers, vessels, assets, assignments, history, part_codes: codes.length, approval_numbers: approvalsSet,
    assets_corrected: assetsCorrected, ownership_replaced: resetIds?.size ?? 0,
  };
}
