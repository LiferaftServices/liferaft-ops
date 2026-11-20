-- The standard service (labor) line for a job, chosen by the raft's service class
-- and capacity. There are three classes: raft, IBA and coastal.

-- Tidy the type as imported, so it is one of the listed choices.
update assets set equipment_type = case
  when upper(trim(equipment_type)) = 'SOLAS A' then 'SOLAS A'
  when upper(trim(equipment_type)) in ('SOLAS B', 'B') then 'SOLAS B'
  when upper(trim(equipment_type)) = 'IBA' then 'IBA'
  when upper(trim(equipment_type)) = 'COASTAL' then 'Coastal'
  when upper(trim(equipment_type)) = 'REC COASTAL' then 'Rec Coastal'
  when upper(trim(equipment_type)) = 'REC OFFSHORE' then 'Rec Offshore'
  when upper(trim(equipment_type)) in ('<24', '<24 H', 'ISO <24HR') then '<24'
  when upper(trim(equipment_type)) in ('>24', 'ISO >24HR') then '>24'
  when equipment_type is null or trim(equipment_type) = '' then null
  else 'Other'
end
where asset_type = 'raft';

-- The class a type normally bills as. Types with no settled answer return null
-- and are chosen by a person.
create function service_class_for(p_type text) returns text
language sql immutable as $$
  select case trim(coalesce(p_type, ''))
    when 'SOLAS A' then 'raft'
    when 'SOLAS B' then 'raft'
    when 'Rec Offshore' then 'raft'
    when '<24' then 'raft'
    when '>24' then 'raft'
    when 'IBA' then 'iba'
    when 'Coastal' then 'coastal'
    else null
  end;
$$;

alter table assets add column service_class text check (service_class in ('raft', 'iba', 'coastal'));
update assets set service_class = service_class_for(equipment_type) where asset_type = 'raft';

create table service_items (
  service_class text not null check (service_class in ('raft', 'iba', 'coastal')),
  capacity integer not null check (capacity > 0),
  item_name text not null,           -- the QuickBooks item name
  primary key (service_class, capacity)
);
alter table service_items enable row level security;
create policy service_items_staff_only on service_items
  for all to authenticated using (is_active_staff()) with check (is_active_staff());

insert into service_items (service_class, capacity, item_name) values
  ('raft', 4, '4PRAFTSERVICE'), ('raft', 6, '6PRAFTSERVICE'), ('raft', 8, '8PRAFTSERVICE'),
  ('raft', 10, '10PRAFTSERVICE'), ('raft', 12, '12PRAFTSERVICE'), ('raft', 16, '16PRAFTSERVICE'),
  ('raft', 20, '20P-RAFT-SRCV'), ('raft', 25, '25P-RAFT-SRVC'),
  ('iba', 4, '4PIBASERVICE'), ('iba', 6, '6PIBASERVICE'), ('iba', 8, '8PIBASERVICE'),
  ('iba', 10, '10PIBASERVICE'), ('iba', 20, '20P-IBA-SRVC'), ('iba', 25, '25P-IBA-SRVC'),
  ('iba', 30, '30P IBA SERVICE'), ('iba', 50, '50PIBASERVICE'), ('iba', 100, '100PIBASERVICE'),
  ('coastal', 4, '4P-CSTL-SRVC'), ('coastal', 6, '6P-CSTL-SRVC'), ('coastal', 8, '8P-CSTL-SRVC');

-- Adds the standard service line to a job when there is an exact rule for the raft's
-- class and capacity. Returns the item name, or null when no rule or no such item.
create function add_standard_service_line(p_job uuid) returns text
language plpgsql set search_path = public as $$
declare
  wanted text;
  item text;
begin
  select si.item_name into wanted
  from service_jobs j
  join assets a on a.id = j.asset_id
  join service_items si on si.service_class = a.service_class and si.capacity = a.capacity
  where j.id = p_job;
  if wanted is null then
    return null;
  end if;
  select qbo_id into item from qbo_items where lower(name) = lower(wanted) and active order by qbo_id limit 1;
  if item is null then
    return null;
  end if;
  if not exists (select 1 from job_lines where job_id = p_job and qbo_item_id = item) then
    perform add_job_line(p_job, item, 1, 'standard');
  end if;
  return wanted;
end;
$$;

-- New rafts get their class from their type.
create function assets_default_service_class() returns trigger
language plpgsql as $$
begin
  if new.asset_type = 'raft' and new.service_class is null then
    new.service_class := service_class_for(new.equipment_type);
  end if;
  return new;
end;
$$;
create trigger assets_default_service_class before insert on assets
  for each row execute function assets_default_service_class();

-- Checking a raft in adds its standard service line.
create function service_jobs_standard_line() returns trigger
language plpgsql as $$
begin
  perform add_standard_service_line(new.id);
  return new;
end;
$$;
create trigger service_jobs_standard_line after insert on service_jobs
  for each row execute function service_jobs_standard_line();

create or replace view asset_overview with (security_invoker = true) as
select
  a.id, a.system_id, a.asset_type, a.brand, a.model, a.serial_number, a.capacity,
  a.equipment_type, a.manufacture_date, a.service_interval_months,
  a.next_service_due, a.last_serviced_on, a.is_loaner, a.retired, a.lapsed, a.confirmed,
  aa.customer_id, c.name as customer_name, c.qbo_customer_id as customer_qbo_id,
  c.phone as customer_phone,
  v.id as vessel_id, v.name as vessel_name,
  lower(concat_ws(' ', a.serial_number, a.system_id, c.name, v.name, a.brand, a.model)) as search_text,
  a.service_class
from assets a
left join asset_assignments aa on aa.asset_id = a.id and aa.effective_to is null
left join customers c on c.id = aa.customer_id
left join vessels v on v.id = aa.vessel_id;
