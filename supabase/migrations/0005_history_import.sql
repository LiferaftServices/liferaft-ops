-- Service history carried over from QuickBooks invoices, Asana and FastField,
-- and two flags the import needs on assets.

alter table assets add column lapsed boolean not null default false;
comment on column assets.lapsed is
  'Long overdue or never serviced here. Kept on record but left off service reminders until confirmed.';

create index assets_next_due_active_idx on assets (next_service_due) where not retired and not lapsed;

create table service_history (
  id            uuid primary key default gen_random_uuid(),
  asset_id      uuid not null references assets (id) on delete cascade,
  serviced_on   date not null,
  source        text not null check (source in ('quickbooks', 'asana', 'fastfield', 'system')),
  location_id   uuid references locations (id),
  reference     text,              -- invoice item, Asana task id or FastField submission id
  customer_name text,              -- as written on the original record
  vessel_name   text,
  job_id        uuid references service_jobs (id),
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index service_history_asset_idx on service_history (asset_id, serviced_on desc);

alter table service_history enable row level security;
create policy service_history_staff_only on service_history
  for all to authenticated using (is_active_staff()) with check (is_active_staff());

-- One row per asset with its current owner and vessel, for lists and search.
-- security_invoker: the view obeys the same row security as the tables under it.
create view asset_overview with (security_invoker = true) as
select
  a.id, a.system_id, a.asset_type, a.brand, a.model, a.serial_number, a.capacity,
  a.equipment_type, a.manufacture_date, a.service_interval_months,
  a.next_service_due, a.last_serviced_on, a.is_loaner, a.retired, a.lapsed, a.confirmed,
  aa.customer_id, c.name as customer_name, c.qbo_customer_id as customer_qbo_id,
  c.phone as customer_phone,
  v.id as vessel_id, v.name as vessel_name,
  lower(concat_ws(' ', a.serial_number, a.system_id, c.name, v.name, a.brand, a.model)) as search_text
from assets a
left join asset_assignments aa on aa.asset_id = a.id and aa.effective_to is null
left join customers c on c.id = aa.customer_id
left join vessels v on v.id = aa.vessel_id;
