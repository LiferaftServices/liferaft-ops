-- A delivery day: one truck going out from one shop on one date, with an optional note
-- ("Dan in his own truck"). Two can share a date when two trucks leave the same shop.

create table route_days (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references routes (id) on delete cascade,
  day date not null,
  note text,
  created_by uuid references staff (id),
  created_at timestamptz not null default now()
);
create index route_days_route_idx on route_days (route_id, day, created_at);
alter table route_days enable row level security;
create policy route_days_staff_only on route_days
  for all to authenticated using (is_active_staff()) with check (is_active_staff());

alter table route_stops add column day_id uuid references route_days (id) on delete set null;
create index route_stops_day_idx on route_stops (day_id, position);

-- Stops already entered get a day of their own date.
insert into route_days (route_id, day)
select distinct route_id, stop_date from route_stops where stop_date is not null;
update route_stops s set day_id = d.id
from route_days d where d.route_id = s.route_id and d.day = s.stop_date and s.day_id is null;
