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
}

export interface ImportResult {
  customers: number;
  vessels: number;
  assets: number;
  assignments: number;
  history: number;
  part_codes: number;
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

  // Order matters: each table refers to the ones before it. Customers arrive parents-first.
  const customers = await load("customers", (file.customers ?? []).map((r) => pick(r, CUSTOMER)));
  const vessels = await load("vessels", (file.vessels ?? []).map((r) => pick(r, VESSEL)));
  // An asset that already exists keeps its label id and any edits made since: skip, never overwrite.
  const assets = await load(
    "assets",
    (file.assets ?? []).map((r) => ({ ...pick(r, ASSET), home_location_id: locationId(r.home_location_code) })),
    true,
  );
  // Past ownership first, so the single "current owner" row per asset never collides.
  const assignmentRows = (file.assignments ?? []).map((r) => pick(r, ASSIGNMENT));
  const assignments =
    (await load("asset_assignments", assignmentRows.filter((r) => r.effective_to !== null), true)) +
    (await load("asset_assignments", assignmentRows.filter((r) => r.effective_to === null), true));
  const history = await load(
    "service_history",
    (file.history ?? []).map((r) => ({ ...pick(r, HISTORY), location_id: locationId(r.location_code) })),
    true,
  );
  // Scan codes are keyed by the code itself. Codes already known are left alone.
  const codes = (file.part_codes ?? [])
    .filter((r) => typeof r.code === "string" && typeof r.part_number === "string" && r.code && r.part_number)
    .map((r) => ({ code: String(r.code).trim(), part_number: String(r.part_number).trim(), source: "import" }));
  for (let i = 0; i < codes.length; i += BATCH) {
    const { error } = await db.from("part_codes").upsert(codes.slice(i, i + BATCH), { onConflict: "code", ignoreDuplicates: true });
    if (error) throw new Error(`Loading scan codes failed: ${error.message}`);
  }
  return { customers, vessels, assets, assignments, history, part_codes: codes.length };
}
