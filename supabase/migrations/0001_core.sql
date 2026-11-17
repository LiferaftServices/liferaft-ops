-- Liferaft Services Operations: core records for stage 1.
-- Customers, vessels, safety assets, service jobs, the event log, loans and routes.
-- Columns used by later stages (billing, inspection, forecasting) are present but unused until then.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

create type staff_role as enum ('admin', 'user');

create type customer_kind as enum (
  'individual', 'company', 'fleet', 'boatyard', 'coop', 'dealer'
);

create type asset_type as enum ('raft', 'epirb_plb', 'suit_set', 'pfd_set');

create type job_stage as enum (
  'scheduled_pickup',
  'picked_up',
  'received',
  'incoming',
  'on_floor',
  'awaiting_estimate',
  'needs_invoice',
  'ready_for_delivery',
  'ready_for_pickup',
  'loaded',
  'delivered',
  'customer_picked_up',
  -- side stages
  'winter_storage',
  'transferred',
  'outside_service',
  'to_be_condemned',
  'do_not_service'
);

create type job_priority as enum ('hot', 'normal', 'seasonal', 'scheduled', 'winter_storage');

create type estimate_status as enum ('not_required', 'required', 'sent', 'approved', 'declined');

create type payment_status as enum ('not_invoiced', 'unpaid', 'pending', 'paid');

create type event_source as enum ('scan', 'web', 'system', 'import');

create type route_direction as enum ('north', 'south', 'special');

create type stop_kind as enum ('pickup', 'delivery', 'loaner_drop', 'loaner_return', 'other');

-- ---------------------------------------------------------------------------
-- Shops and staff
-- ---------------------------------------------------------------------------

create table locations (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,          -- 'york', 'belfast'
  name        text not null,
  uscg_notice_email text,                    -- where this shop's USCG servicing notice goes (stage 2)
  created_at  timestamptz not null default now()
);

create table staff (
  id          uuid primary key,              -- matches the sign-in user id
  full_name   text not null,
  email       text not null unique,
  role        staff_role not null default 'user',
  home_location_id uuid references locations (id),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Customer tree (QuickBooks Online is the source of truth for who gets invoiced)
-- ---------------------------------------------------------------------------

create table customers (
  id                  uuid primary key default gen_random_uuid(),
  qbo_customer_id     text unique,           -- null until matched or pushed to QBO
  parent_id           uuid references customers (id),
  name                text not null,
  kind                customer_kind not null default 'individual',
  phone               text,
  email               text,
  billing_address     text,
  do_not_service      boolean not null default false,
  do_not_loan         boolean not null default false,
  payment_hold_exempt boolean not null default false,
  partner_terms       jsonb not null default '{}'::jsonb,  -- discount / commission / paperwork rules (stage 2)
  notes               text,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint customers_not_own_parent check (parent_id is null or parent_id <> id)
);
create index customers_parent_idx on customers (parent_id);
create index customers_name_idx on customers (lower(name));

create table contacts (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references customers (id) on delete cascade,
  full_name     text not null,
  phone         text,
  email         text,
  notify_email  boolean not null default true,
  notify_sms    boolean not null default true,
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now()
);
create index contacts_customer_idx on contacts (customer_id);

create table vessels (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references customers (id),
  name            text not null,
  vessel_type     text,
  official_number text,
  home_port       text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index vessels_customer_idx on vessels (customer_id);
create index vessels_name_idx on vessels (lower(name));

-- Dated gear kept on the vessel but not tracked as its own asset (flares and similar).
create table vessel_gear (
  id          uuid primary key default gen_random_uuid(),
  vessel_id   uuid not null references vessels (id) on delete cascade,
  description text not null,
  quantity    integer not null default 1 check (quantity > 0),
  expiry_date date,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Safety assets: rafts, EPIRBs/PLBs, and suit or PFD sets
-- ---------------------------------------------------------------------------

create table assets (
  id                      uuid primary key default gen_random_uuid(),
  system_id               text not null unique,     -- printed on the QR label, e.g. LRS-7K2M9QXD4T
  asset_type              asset_type not null,
  brand                   text,
  model                   text,
  serial_number           text,
  lot_number              text,
  capacity                integer,
  equipment_type          text,                     -- SOLAS A, SOLAS B, Coastal, IBA ...
  fabric                  text,
  container_type          text,                     -- LPC, valise, round ...
  manufacture_date        date,
  approval_number         text,
  painter_length_m        numeric(6,2),
  drop_height_m           numeric(6,2),
  shackle_count           integer,
  hru_status              text,
  lashing                 text[],
  item_count              integer,                  -- for suit and PFD sets
  service_interval_months integer check (service_interval_months between 1 and 120),
  next_service_due        date,
  last_serviced_on        date,
  home_location_id        uuid references locations (id),
  is_loaner               boolean not null default false,
  retired                 boolean not null default false,
  retired_reason          text,
  attributes              jsonb not null default '{}'::jsonb,
  revision                integer not null default 1,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint assets_system_id_format check (system_id ~ '^LRS-[0-9A-HJKMNP-TV-Z]{10}$')
);
create index assets_serial_idx on assets (lower(serial_number));
create index assets_due_idx on assets (next_service_due) where retired = false;
create index assets_loaner_idx on assets (is_loaner) where is_loaner;

-- One line per suit or PFD inside a set.
create table asset_set_items (
  id               uuid primary key default gen_random_uuid(),
  asset_id         uuid not null references assets (id) on delete cascade,
  brand            text,
  model            text,
  size             text,
  serial_number    text,
  equipment_code   text,                    -- the per-item barcode some PFDs already carry
  manufacture_date date,
  last_result      text,                    -- pass / fail / condemned
  notes            text,
  created_at       timestamptz not null default now()
);
create index asset_set_items_asset_idx on asset_set_items (asset_id);

-- Who owns an asset and which vessel it is on, with history.
-- The current assignment is the row whose effective_to is null.
create table asset_assignments (
  id             uuid primary key default gen_random_uuid(),
  asset_id       uuid not null references assets (id) on delete cascade,
  customer_id    uuid not null references customers (id),
  vessel_id      uuid references vessels (id),
  effective_from timestamptz not null default now(),
  effective_to   timestamptz,
  reason         text,
  created_by     uuid references staff (id),
  constraint asset_assignments_range check (effective_to is null or effective_to > effective_from)
);
create unique index asset_assignments_one_current on asset_assignments (asset_id) where effective_to is null;
create index asset_assignments_customer_idx on asset_assignments (customer_id) where effective_to is null;
create index asset_assignments_vessel_idx on asset_assignments (vessel_id) where effective_to is null;

-- ---------------------------------------------------------------------------
-- Service jobs
-- ---------------------------------------------------------------------------

create sequence service_job_number_seq start 10001;

create table service_jobs (
  id                    uuid primary key default gen_random_uuid(),
  job_number            text not null unique default ('SVC-' || nextval('service_job_number_seq')),
  asset_id              uuid not null references assets (id),
  location_id           uuid not null references locations (id),
  stage                 job_stage not null,
  stage_before_side     job_stage,              -- where to return to after a side stage
  priority              job_priority not null default 'normal',
  service_type          text,                   -- Annual, 5-Yr/GI, NAP, FS ...
  pickup_location       text,
  dropped_off_by        text,
  billing_customer_id   uuid references customers (id),
  estimate_status       estimate_status not null default 'not_required',
  uscg_witness_requested boolean not null default false,
  technician_id         uuid references staff (id),
  storage_location      text,
  notes                 text,
  date_received         date,
  -- billing (stage 2)
  qbo_estimate_id       text,
  qbo_invoice_id        text,
  payment_status        payment_status not null default 'not_invoiced',
  payment_hold_override_by uuid references staff (id),
  payment_hold_override_note text,
  cert_status           text,
  -- migration
  asana_task_gid        text unique,
  revision              integer not null default 1,
  opened_at             timestamptz not null default now(),
  closed_at             timestamptz
);
create index service_jobs_asset_idx on service_jobs (asset_id);
create index service_jobs_stage_idx on service_jobs (location_id, stage) where closed_at is null;
-- An asset has at most one open job at a time.
create unique index service_jobs_one_open on service_jobs (asset_id) where closed_at is null;

-- ---------------------------------------------------------------------------
-- Event log: every scan, edit, message and integration result. Never edited or deleted.
-- ---------------------------------------------------------------------------

create table job_events (
  id          bigint generated always as identity primary key,
  asset_id    uuid references assets (id),
  job_id      uuid references service_jobs (id),
  customer_id uuid references customers (id),
  actor_id    uuid references staff (id),      -- null for system actions
  source      event_source not null,
  action      text not null,                   -- 'begin_service', 'asset_registered', 'owner_changed' ...
  from_stage  job_stage,
  to_stage    job_stage,
  note        text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index job_events_asset_idx on job_events (asset_id, created_at desc);
create index job_events_job_idx on job_events (job_id, created_at desc);

create function job_events_are_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'job_events rows cannot be changed or removed';
end;
$$;

create trigger job_events_no_update before update on job_events
  for each row execute function job_events_are_immutable();
create trigger job_events_no_delete before delete on job_events
  for each row execute function job_events_are_immutable();

-- ---------------------------------------------------------------------------
-- Loaners
-- ---------------------------------------------------------------------------

create table loans (
  id            uuid primary key default gen_random_uuid(),
  asset_id      uuid not null references assets (id),      -- the loaner raft
  customer_id   uuid not null references customers (id),
  vessel_id     uuid references vessels (id),
  job_id        uuid references service_jobs (id),          -- the customer's raft being serviced
  signed_out_at timestamptz not null default now(),
  signed_out_by uuid references staff (id),
  returned_at   timestamptz,
  returned_to   uuid references staff (id),
  notes         text,
  constraint loans_range check (returned_at is null or returned_at >= signed_out_at)
);
-- A loaner can only be out with one customer at a time.
create unique index loans_one_open on loans (asset_id) where returned_at is null;
create index loans_customer_idx on loans (customer_id);

create table loan_waitlist (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references customers (id),
  location_id   uuid references locations (id),
  requested_at  timestamptz not null default now(),
  capacity_needed integer,
  notes         text,
  fulfilled_loan_id uuid references loans (id),
  cancelled_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- Routes
-- ---------------------------------------------------------------------------

create table saved_places (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                 -- 'Cape Ann drop point', a boatyard, a co-op
  address     text,
  customer_id uuid references customers (id),
  contact_phone text,
  notes       text
);

create table routes (
  id          uuid primary key default gen_random_uuid(),
  direction   route_direction not null,
  week_start  date not null,
  name        text,
  created_at  timestamptz not null default now(),
  unique (direction, week_start, name)
);

create table route_stops (
  id            uuid primary key default gen_random_uuid(),
  route_id      uuid not null references routes (id) on delete cascade,
  kind          stop_kind not null,
  job_id        uuid references service_jobs (id),
  asset_id      uuid references assets (id),
  place_id      uuid references saved_places (id),
  stop_date     date,                        -- null while unscheduled
  position      integer,                     -- order within the day
  title         text not null,
  address       text,
  contact_phone text,
  notes         text,
  completed_at  timestamptz,
  completed_by  uuid references staff (id),
  created_at    timestamptz not null default now()
);
create index route_stops_route_idx on route_stops (route_id, stop_date, position);

-- ---------------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------------

create function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger customers_touch before update on customers
  for each row execute function touch_updated_at();
create trigger assets_touch before update on assets
  for each row execute function touch_updated_at();

insert into locations (code, name, uscg_notice_email) values
  ('york', 'York Raft Service', null),
  ('belfast', 'Belfast Raft Service', 'SMB-USCGMSUBelfast@uscg.mil');
