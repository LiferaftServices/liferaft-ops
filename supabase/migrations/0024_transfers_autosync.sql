-- A raft transferred to the other shop becomes a real job on that shop's board, and remembers
-- which shop received it so it can go back there. Also: keep the QuickBooks customer copy fresh.

alter table service_jobs add column origin_location_id uuid references locations (id);

-- Jobs parked in the old "Transferred to other shop" section move to the other shop's board.
update service_jobs j set
  origin_location_id = j.location_id,
  location_id = (select l.id from locations l where l.id <> j.location_id order by l.name limit 1),
  stage = coalesce(j.stage_before_side, 'received'),
  stage_before_side = null
where j.stage = 'transferred' and j.closed_at is null
  and (select count(*) from locations l where l.id <> j.location_id) = 1;

create function transfer_job(p_job uuid, p_to uuid default null) returns text
language plpgsql set search_path = public as $$
declare
  j service_jobs%rowtype;
  dest locations%rowtype;
  src text;
begin
  if not is_active_staff() then
    raise exception 'Only staff can transfer a raft.';
  end if;
  select * into j from service_jobs where id = p_job and closed_at is null for update;
  if not found then
    raise exception 'That job is closed or no longer exists.';
  end if;
  if p_to is not null then
    select * into dest from locations where id = p_to and id <> j.location_id;
  elsif (select count(*) from locations where id <> j.location_id) = 1 then
    select * into dest from locations where id <> j.location_id;
  end if;
  if dest.id is null then
    raise exception 'Choose which shop to transfer to.';
  end if;
  select name into src from locations where id = j.location_id;

  update service_jobs set
    origin_location_id = coalesce(origin_location_id, location_id),
    location_id = dest.id,
    scheduled_start = null,   -- the dates belonged to the other shop's schedule
    scheduled_due = null,
    revision = revision + 1
  where id = p_job;
  insert into job_events (asset_id, job_id, customer_id, actor_id, source, action, from_stage, to_stage, note)
  values (j.asset_id, j.id, j.billing_customer_id, auth.uid(), 'web', 'transfer', j.stage, j.stage,
          'Transferred from ' || src || ' to ' || dest.name);
  return dest.name;
end;
$$;

create or replace view job_board with (security_invoker = true) as
select
  j.id, j.job_number, j.stage, j.stage_before_side, j.priority, j.estimate_status, j.payment_status,
  j.date_received, j.location_id, l.name as location_name, j.notes, j.pickup_location,
  (j.payment_hold_override_by is not null) as payment_hold_acknowledged,
  coalesce(bc.payment_hold_exempt, false) as payment_hold_exempt,
  o.id as asset_id, o.serial_number, o.brand, o.capacity, o.equipment_type,
  o.customer_name, o.vessel_name, o.is_loaner,
  j.scheduled_start, j.scheduled_due,
  j.qbo_invoice_id, j.qbo_invoice_number, j.invoice_total, j.invoice_balance,
  exists (select 1 from job_invoices i where i.job_id = j.id and i.changed_in_qbo) as invoice_changed,
  exists (select 1 from job_lines x where x.job_id = j.id and x.invoice_id is null and j.qbo_invoice_id is not null) as has_uninvoiced_items,
  j.origin_location_id, ol.name as origin_location_name
from service_jobs j
join asset_overview o on o.id = j.asset_id
join locations l on l.id = j.location_id
left join locations ol on ol.id = j.origin_location_id
left join customers bc on bc.id = j.billing_customer_id
where j.closed_at is null;

-- Lets the app refresh its copy of QuickBooks customers once a day without anyone clicking.
-- Returns true to the one caller who should run the refresh.
alter table qbo_connection add column auto_sync_claimed_at timestamptz;
create function claim_qbo_auto_sync(p_hours integer default 24) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if not is_active_staff() then
    return false;
  end if;
  update qbo_connection set auto_sync_claimed_at = now()
   where coalesce(last_sync_at, 'epoch') < now() - make_interval(hours => p_hours)
     and coalesce(auto_sync_claimed_at, 'epoch') < now() - interval '2 hours';
  get diagnostics n = row_count;
  return n = 1;
end;
$$;
