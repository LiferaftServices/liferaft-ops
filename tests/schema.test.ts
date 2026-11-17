// Applies the real migration files to an in-memory Postgres and checks the rules
// the rest of the system relies on.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, describe, expect, it } from "vitest";
import { newSystemId } from "../src/lib/system-id";

const MIGRATIONS = join(__dirname, "..", "supabase", "migrations");

let db: PGlite;
const ids: Record<string, string> = {};

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const res = await db.query<T>(sql, params);
  return res.rows[0];
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  // Stand-ins for what the hosted database provides: the sign-in schema and role.
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role authenticated;
  `);
  for (const file of readdirSync(MIGRATIONS).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }

  ids.york = (await one<{ id: string }>(`select id from locations where code = 'york'`)).id;
  ids.fleet = (
    await one<{ id: string }>(
      `insert into customers (name, kind) values ('TRAINING Fleet Co', 'fleet') returning id`,
    )
  ).id;
  ids.owner = (
    await one<{ id: string }>(
      `insert into customers (name, kind, parent_id) values ('TRAINING Owner', 'individual', $1) returning id`,
      [ids.fleet],
    )
  ).id;
  ids.buyer = (
    await one<{ id: string }>(
      `insert into customers (name) values ('TRAINING Buyer') returning id`,
    )
  ).id;
  ids.vessel = (
    await one<{ id: string }>(
      `insert into vessels (customer_id, name) values ($1, 'F/V TRAINING') returning id`,
      [ids.owner],
    )
  ).id;
  ids.raft = (
    await one<{ id: string }>(
      `insert into assets (system_id, asset_type, brand, model, serial_number, capacity, service_interval_months)
       values ($1, 'raft', 'TRAINING', 'Coastal', 'TRAIN-001', 4, 12) returning id`,
      [newSystemId()],
    )
  ).id;
});

describe("migrations", () => {
  it("create both shops", async () => {
    const row = await one<{ n: number }>(`select count(*)::int as n from locations`);
    expect(row.n).toBe(2);
  });

  it("turn on row-level security for every table", async () => {
    const res = await db.query<{ relname: string }>(
      `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(res.rows.map((r) => r.relname)).toEqual([]);
  });
});

describe("customer tree", () => {
  it("nests an owner under a fleet", async () => {
    const row = await one<{ parent: string }>(
      `select p.name as parent from customers c join customers p on p.id = c.parent_id where c.id = $1`,
      [ids.owner],
    );
    expect(row.parent).toBe("TRAINING Fleet Co");
  });

  it("refuses a customer as its own parent", async () => {
    await expect(
      db.query(`update customers set parent_id = id where id = $1`, [ids.fleet]),
    ).rejects.toThrow();
  });
});

describe("assets", () => {
  it("reject a malformed system ID", async () => {
    await expect(
      db.query(`insert into assets (system_id, asset_type) values ('LRS-OOPS', 'raft')`),
    ).rejects.toThrow();
  });

  it("keep ownership history when a raft is sold", async () => {
    await db.query(
      `insert into asset_assignments (asset_id, customer_id, vessel_id, reason) values ($1, $2, $3, 'Initial registration')`,
      [ids.raft, ids.owner, ids.vessel],
    );
    // A second current owner is not allowed until the first is closed.
    await expect(
      db.query(`insert into asset_assignments (asset_id, customer_id) values ($1, $2)`, [
        ids.raft,
        ids.buyer,
      ]),
    ).rejects.toThrow();

    await db.query(
      `update asset_assignments set effective_to = now() + interval '1 second' where asset_id = $1 and effective_to is null`,
      [ids.raft],
    );
    await db.query(
      `insert into asset_assignments (asset_id, customer_id, effective_from, reason) values ($1, $2, now() + interval '1 second', 'Sold')`,
      [ids.raft, ids.buyer],
    );
    const history = await db.query(`select 1 from asset_assignments where asset_id = $1`, [ids.raft]);
    expect(history.rows.length).toBe(2);
    const current = await one<{ name: string }>(
      `select c.name from asset_assignments a join customers c on c.id = a.customer_id
       where a.asset_id = $1 and a.effective_to is null`,
      [ids.raft],
    );
    expect(current.name).toBe("TRAINING Buyer");
  });

  it("hold a suit set with a line per suit", async () => {
    const set = await one<{ id: string }>(
      `insert into assets (system_id, asset_type, item_count) values ($1, 'suit_set', 2) returning id`,
      [newSystemId()],
    );
    await db.query(
      `insert into asset_set_items (asset_id, brand, size, serial_number, last_result)
       values ($1, 'Imperial', 'Universal', 'S-1', 'pass'), ($1, 'Mustang', 'Jumbo', 'S-2', 'fail')`,
      [set.id],
    );
    const row = await one<{ n: number }>(
      `select count(*)::int as n from asset_set_items where asset_id = $1`,
      [set.id],
    );
    expect(row.n).toBe(2);
  });
});

describe("service jobs", () => {
  it("number jobs and allow only one open job per asset", async () => {
    const job = await one<{ id: string; job_number: string }>(
      `insert into service_jobs (asset_id, location_id, stage) values ($1, $2, 'received') returning id, job_number`,
      [ids.raft, ids.york],
    );
    ids.job = job.id;
    expect(job.job_number).toMatch(/^SVC-\d+$/);
    await expect(
      db.query(`insert into service_jobs (asset_id, location_id, stage) values ($1, $2, 'received')`, [
        ids.raft,
        ids.york,
      ]),
    ).rejects.toThrow();
  });

  it("allow a new job once the last one is closed", async () => {
    await db.query(`update service_jobs set stage = 'delivered', closed_at = now() where id = $1`, [
      ids.job,
    ]);
    const next = await one<{ id: string }>(
      `insert into service_jobs (asset_id, location_id, stage) values ($1, $2, 'scheduled_pickup') returning id`,
      [ids.raft, ids.york],
    );
    expect(next.id).toBeTruthy();
  });
});

describe("event log", () => {
  it("cannot be edited or deleted", async () => {
    await db.query(
      `insert into job_events (asset_id, job_id, source, action, to_stage) values ($1, $2, 'web', 'receive', 'received')`,
      [ids.raft, ids.job],
    );
    await expect(db.query(`update job_events set note = 'changed'`)).rejects.toThrow(/cannot be changed/);
    await expect(db.query(`delete from job_events`)).rejects.toThrow(/cannot be changed/);
  });
});

describe("loaners", () => {
  it("can only be out with one customer at a time, and keep their lending history", async () => {
    const loaner = await one<{ id: string }>(
      `insert into assets (system_id, asset_type, is_loaner, brand) values ($1, 'raft', true, 'TRAINING') returning id`,
      [newSystemId()],
    );
    const loan = await one<{ id: string }>(
      `insert into loans (asset_id, customer_id) values ($1, $2) returning id`,
      [loaner.id, ids.owner],
    );
    await expect(
      db.query(`insert into loans (asset_id, customer_id) values ($1, $2)`, [loaner.id, ids.buyer]),
    ).rejects.toThrow();
    await db.query(`update loans set returned_at = now() + interval '1 day' where id = $1`, [loan.id]);
    await db.query(`insert into loans (asset_id, customer_id) values ($1, $2)`, [loaner.id, ids.buyer]);

    // Selling the loaner: switch the attribute off; the history stays.
    await db.query(`update assets set is_loaner = false where id = $1`, [loaner.id]);
    const row = await one<{ n: number }>(`select count(*)::int as n from loans where asset_id = $1`, [
      loaner.id,
    ]);
    expect(row.n).toBe(2);
  });
});
