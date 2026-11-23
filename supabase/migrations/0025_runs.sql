-- Pickup and delivery runs. A run is one direction (North, South, or a special trip such as
-- Vinalhaven) for one week. It holds stops, each on a day; a stop is a place, and under it
-- sit the individual things to do there (deliver this raft, pick up that one, drop equipment).

alter table route_stops alter column kind set default 'other';
alter table route_stops add column contact_name text;
alter table route_stops add column call_ahead text;
alter table route_stops add column created_by uuid references staff (id);

create table stop_items (
  id uuid primary key default gen_random_uuid(),
  stop_id uuid not null references route_stops (id) on delete cascade,
  kind text not null check (kind in ('deliver', 'pickup', 'equipment', 'transfer', 'loaner', 'other')),
  job_id uuid references service_jobs (id) on delete set null,
  asset_id uuid references assets (id) on delete set null,
  description text not null,
  done_at timestamptz,
  done_by uuid references staff (id),
  created_by uuid references staff (id),
  created_at timestamptz not null default now()
);
create index stop_items_stop_idx on stop_items (stop_id, created_at);
create index stop_items_job_idx on stop_items (job_id);
alter table stop_items enable row level security;
create policy stop_items_staff_only on stop_items
  for all to authenticated using (is_active_staff()) with check (is_active_staff());

alter table saved_places add constraint saved_places_name_key unique (name);
