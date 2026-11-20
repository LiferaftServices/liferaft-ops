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

describe("QuickBooks links", () => {
  it("posts an invoice to the most specific QuickBooks record, and follows a sale", async () => {
    const acct = await one<{ id: string }>(
      `insert into customers (name, kind, qbo_customer_id) values ('TRAINING Fleet Two', 'fleet', 'Q-PARENT') returning id`,
    );
    const vessel = await one<{ id: string }>(
      `insert into vessels (customer_id, name, qbo_customer_id) values ($1, 'TRAINING Lady', 'Q-VESSEL') returning id`,
      [acct.id],
    );
    const mk = async () =>
      (
        await one<{ id: string }>(
          `insert into assets (system_id, asset_type) values ($1, 'raft') returning id`,
          [newSystemId()],
        )
      ).id;
    const withOwn = await mk();
    const onVessel = await mk();
    const onAccount = await mk();
    await db.query(
      `insert into asset_assignments (asset_id, customer_id, vessel_id, qbo_customer_id) values
         ($1, $4, $5, 'Q-RAFT'), ($2, $4, $5, null), ($3, $4, null, null)`,
      [withOwn, onVessel, onAccount, acct.id, vessel.id],
    );
    const pick = async (id: string) =>
      (await one<{ q: string }>(`select invoice_qbo_customer_id($1) as q`, [id])).q;
    expect(await pick(withOwn)).toBe("Q-RAFT");
    expect(await pick(onVessel)).toBe("Q-VESSEL");
    expect(await pick(onAccount)).toBe("Q-PARENT");

    // The raft with its own QuickBooks record is sold to another customer.
    const buyer = await one<{ id: string }>(
      `insert into customers (name, qbo_customer_id) values ('TRAINING Second Owner', 'Q-BUYER') returning id`,
    );
    await db.query(
      `update asset_assignments set effective_to = now() + interval '1 second' where asset_id = $1 and effective_to is null`,
      [withOwn],
    );
    await db.query(
      `insert into asset_assignments (asset_id, customer_id, effective_from, reason) values ($1, $2, now() + interval '1 second', 'Sold')`,
      [withOwn, buyer.id],
    );
    expect(await pick(withOwn)).toBe("Q-BUYER");
  });
});

describe("QuickBooks connection", () => {
  it("hides the tokens from staff logins but lets them read the customer copy", async () => {
    const staff = await one<{ id: string }>(
      `insert into staff (id, full_name, email, role) values (gen_random_uuid(), 'TRAINING Staff', 'training-qbo@example.test', 'user') returning id`,
    );
    await db.query(
      `insert into qbo_connection (environment, realm_id, access_token, access_expires_at, refresh_token)
       values ('sandbox', '123', 'ACCESS', now(), 'REFRESH')`,
    );
    await db.query(
      `insert into qbo_customers (qbo_id, display_name, fully_qualified_name) values ('1', 'TRAINING Co', 'TRAINING Co')`,
    );
    await db.exec(`grant usage on schema public to authenticated;
      grant select, insert on qbo_connection, qbo_customers to authenticated;
      grant execute on function qbo_connection_status() to authenticated;`);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${staff.id}';`);
    try {
      expect((await db.query(`select * from qbo_connection`)).rows).toHaveLength(0);
      expect((await db.query(`select * from qbo_customers`)).rows).toHaveLength(1);
      const status = await one<Record<string, unknown>>(`select * from qbo_connection_status()`);
      expect(status.realm_id).toBe("123");
      expect(Object.keys(status)).not.toContain("access_token");
      await expect(
        db.query(`insert into qbo_customers (qbo_id, display_name, fully_qualified_name) values ('2', 'x', 'x')`),
      ).rejects.toThrow();
    } finally {
      await db.exec(`reset role; reset request.jwt.claim.sub;`);
    }
    await expect(
      db.query(
        `insert into qbo_connection (environment, realm_id, access_token, access_expires_at, refresh_token)
         values ('sandbox', '456', 'A', now(), 'R')`,
      ),
    ).rejects.toThrow(); // only ever one connected company
  });
});

describe("reassigning an asset", () => {
  it("closes the old ownership, opens the new one, and keeps both", async () => {
    const staff = await one<{ id: string }>(
      `insert into staff (id, full_name, email, role) values (gen_random_uuid(), 'TRAINING Mover', 'training-move@example.test', 'user') returning id`,
    );
    const a = await one<{ id: string }>(`insert into customers (name) values ('TRAINING Seller') returning id`);
    const b = await one<{ id: string }>(`insert into customers (name) values ('TRAINING New Owner') returning id`);
    const v = await one<{ id: string }>(
      `insert into vessels (customer_id, name) values ($1, 'F/V TRAINING TWO') returning id`,
      [b.id],
    );
    const asset = await one<{ id: string }>(
      `insert into assets (system_id, asset_type, serial_number) values ($1, 'raft', 'TRAIN-MOVE') returning id`,
      [newSystemId()],
    );
    // An imported ownership dated later today, as the import writes them.
    await db.query(
      `insert into asset_assignments (asset_id, customer_id, effective_from) values ($1, $2, now() + interval '3 hours')`,
      [asset.id, a.id],
    );
    await db.exec(`set request.jwt.claim.sub = '${staff.id}';`);
    try {
      await db.query(`select reassign_asset($1, $2, $3, 'Sold')`, [asset.id, b.id, v.id]);
      const rows = (
        await db.query<{ customer_id: string; effective_to: string | null; reason: string | null }>(
          `select customer_id, effective_to, reason from asset_assignments where asset_id = $1 order by effective_from`,
          [asset.id],
        )
      ).rows;
      expect(rows).toHaveLength(2);
      expect(rows[0].customer_id).toBe(a.id);
      expect(rows[0].effective_to).not.toBeNull();
      expect(rows[1]).toMatchObject({ customer_id: b.id, effective_to: null, reason: "Sold" });
      // Asking for the same owner and vessel again changes nothing.
      await db.query(`select reassign_asset($1, $2, $3, 'Sold')`, [asset.id, b.id, v.id]);
      expect(
        (await one<{ n: number }>(`select count(*)::int n from asset_assignments where asset_id = $1`, [asset.id])).n,
      ).toBe(2);
    } finally {
      await db.exec(`reset request.jwt.claim.sub;`);
    }
    await expect(db.query(`select reassign_asset($1, $2, null, 'x')`, [asset.id, a.id])).rejects.toThrow(/Only staff/);
  });
});

describe("intake", () => {
  it("finds a raft however its serial was typed, registers a new one once, and checks it in once", async () => {
    const staff = await one<{ id: string }>(
      `insert into staff (id, full_name, email, role) values (gen_random_uuid(), 'TRAINING Intake', 'training-intake@example.test', 'user') returning id`,
    );
    const c = await one<{ id: string }>(`insert into customers (name) values ('TRAINING Intake Owner') returning id`);
    expect((await one<{ k: string }>(`select serial_key(' s9083-a0 ') as k`)).k).toBe("59083A0");
    await db.exec(`set request.jwt.claim.sub = '${staff.id}';`);
    try {
      const reg = (serial: string) =>
        db.query<{ id: string }>(
          `select register_raft($1, null, $2, $3, 'TRAINING', 'Coastal', 4, 'Coastal', '2020-01-31', 12, $4) as id`,
          [c.id, newSystemId(), serial, ids.york],
        );
      const raft = (await reg("TRN-S9083")).rows[0].id;
      await expect(reg("trn 59083")).rejects.toThrow(/already on record/);
      const found = (await db.query<{ id: string }>(`select id from find_assets_by_serial('TRN59O83')`)).rows;
      expect(found.map((r) => r.id)).toEqual([raft]);

      const checkIn = () =>
        db.query<{ id: string }>(
          `select check_in_asset($1, $2, 'normal', true, 'York drop off', 'TRAINING Person', null, 'TRAINING note') as id`,
          [raft, ids.york],
        );
      const job = (await checkIn()).rows[0].id;
      await expect(checkIn()).rejects.toThrow(/already has an open service job/);
      const j = await one<{ stage: string; estimate_status: string; billing_customer_id: string; job_number: string }>(
        `select stage, estimate_status, billing_customer_id, job_number from service_jobs where id = $1`,
        [job],
      );
      expect(j).toMatchObject({ stage: "received", estimate_status: "required", billing_customer_id: c.id });
      expect(j.job_number).toMatch(/^SVC-\d+$/);
      const events = (
        await db.query<{ action: string }>(`select action from job_events where asset_id = $1 order by id`, [raft])
      ).rows.map((r) => r.action);
      expect(events).toEqual(["asset_registered", "checked_in"]);
    } finally {
      await db.exec(`reset request.jwt.claim.sub;`);
    }
  });
});

describe("moving a job", () => {
  it("moves only from the stage the person saw, logs it, and records the service at sign-off", async () => {
    const staff = await one<{ id: string }>(
      `insert into staff (id, full_name, email, role) values (gen_random_uuid(), 'TRAINING Tech', 'training-tech@example.test', 'user') returning id`,
    );
    const c = await one<{ id: string }>(`insert into customers (name) values ('TRAINING Board Owner') returning id`);
    await db.exec(`set request.jwt.claim.sub = '${staff.id}';`);
    try {
      const raft = (
        await db.query<{ id: string }>(
          `select register_raft($1, null, $2, 'TRN-BOARD-1', 'TRAINING', null, 6, 'SOLAS A', null, 12, $3) as id`,
          [c.id, newSystemId(), ids.york],
        )
      ).rows[0].id;
      const job = (
        await db.query<{ id: string }>(`select check_in_asset($1, $2, 'hot', false, null, null, null, null) as id`, [raft, ids.york])
      ).rows[0].id;
      const move = (from: string, to: string, action: string, closes = false) =>
        db.query(`select move_job($1, $2, $3, $4, $5, null, null, null)`, [job, from, to, action, closes]);

      await move("received", "incoming", "schedule_service");
      await expect(move("received", "incoming", "schedule_service")).rejects.toThrow(/already moved/);
      await move("incoming", "on_floor", "begin_service");
      expect((await one<{ t: string }>(`select technician_id as t from service_jobs where id = $1`, [job])).t).toBe(staff.id);
      await move("on_floor", "needs_invoice", "complete_inspection");

      const a = await one<{ last: string; due: string }>(
        `select last_serviced_on::text as last, next_service_due::text as due from assets where id = $1`,
        [raft],
      );
      expect(a.last).toBe((await one<{ d: string }>(`select current_date::text as d`)).d);
      expect(a.due).toBe((await one<{ d: string }>(`select (current_date + interval '12 months')::date::text as d`)).d);
      expect((await one<{ n: number }>(`select count(*)::int n from service_history where job_id = $1`, [job])).n).toBe(1);
      expect((await one<{ n: number }>(`select count(*)::int n from job_board where id = $1`, [job])).n).toBe(1);

      await move("needs_invoice", "ready_for_pickup", "invoice_for_pickup");
      await move("ready_for_pickup", "customer_picked_up", "customer_collects", true);
      expect((await one<{ n: number }>(`select count(*)::int n from job_board where id = $1`, [job])).n).toBe(0);
      await expect(move("customer_picked_up", "received", "x")).rejects.toThrow(/closed/);
      const log = (await db.query<{ action: string }>(`select action from job_events where job_id = $1 order by id`, [job])).rows;
      expect(log.map((r) => r.action)).toEqual([
        "checked_in", "schedule_service", "begin_service", "complete_inspection", "invoice_for_pickup", "customer_collects",
      ]);
    } finally {
      await db.exec(`reset request.jwt.claim.sub;`);
    }
  });
});

describe("parts on a job", () => {
  it("adds a part once and raises the quantity on a repeat scan", async () => {
    const staff = await one<{ id: string }>(
      `insert into staff (id, full_name, email, role) values (gen_random_uuid(), 'TRAINING Parts', 'training-parts@example.test', 'user') returning id`,
    );
    const c = await one<{ id: string }>(`insert into customers (name) values ('TRAINING Parts Owner') returning id`);
    await db.query(
      `insert into qbo_items (qbo_id, name, fully_qualified_name, unit_price, taxable, active) values
       ('T1', 'TRN-PART-1', 'Service Parts:TRN-PART-1', 12.5, true, true), ('T2', 'TRN-OLD', 'Service Parts:TRN-OLD', 1, true, false)`,
    );
    await db.exec(`set request.jwt.claim.sub = '${staff.id}';`);
    try {
      const raft = (
        await db.query<{ id: string }>(
          `select register_raft($1, null, $2, 'TRN-PARTS-RAFT', 'TRAINING', null, 4, 'Coastal', null, 12, $3) as id`,
          [c.id, newSystemId(), ids.york],
        )
      ).rows[0].id;
      const job = (
        await db.query<{ id: string }>(`select check_in_asset($1, $2, 'normal', false, null, null, null, null) as id`, [raft, ids.york])
      ).rows[0].id;
      await db.query(`select add_job_line($1, 'T1', 1, 'scan')`, [job]);
      await db.query(`select add_job_line($1, 'T1', 2, 'scan')`, [job]);
      const lines = (await db.query<{ quantity: string; unit_price: string; part_number: string }>(
        `select quantity, unit_price, part_number from job_lines where job_id = $1`, [job],
      )).rows;
      expect(lines).toHaveLength(1);
      expect(Number(lines[0].quantity)).toBe(3);
      expect(Number(lines[0].unit_price)).toBe(12.5);
      await expect(db.query(`select add_job_line($1, 'T2', 1, 'manual')`, [job])).rejects.toThrow(/not an active/);
    } finally {
      await db.exec(`reset request.jwt.claim.sub;`);
    }
  });
});
