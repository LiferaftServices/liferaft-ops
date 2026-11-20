-- Intake: finding a raft by serial however it was typed, registering a new one,
-- and checking an asset in for service.

-- One comparison key for a serial: letters and digits only, upper case, with
-- look-alike characters folded together (S/5, O/0/Q, I/L/1, B/8, Z/2, G/6).
create function serial_key(p text) returns text
language sql immutable parallel safe as $$
  select translate(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), 'SOILBZGQ', '50118260');
$$;

create index assets_serial_key_idx on assets (serial_key(serial_number));

create function find_assets_by_serial(p_serial text)
returns setof asset_overview
language sql stable set search_path = public as $$
  select o.* from asset_overview o
  where length(serial_key(p_serial)) >= 4
    and serial_key(o.serial_number) = serial_key(p_serial);
$$;

create function register_raft(
  p_customer uuid,
  p_vessel uuid,
  p_system_id text,
  p_serial text,
  p_brand text,
  p_model text,
  p_capacity integer,
  p_equipment_type text,
  p_manufacture_date date,
  p_interval_months integer,
  p_location uuid
) returns uuid
language plpgsql set search_path = public as $$
declare
  new_id uuid;
begin
  if not is_active_staff() then
    raise exception 'Only staff can register an asset.';
  end if;
  if length(serial_key(p_serial)) < 4 then
    raise exception 'A raft needs a serial number of at least four characters.';
  end if;
  if exists (select 1 from assets a where serial_key(a.serial_number) = serial_key(p_serial) and a.asset_type = 'raft') then
    raise exception 'A raft with this serial number is already on record.';
  end if;

  insert into assets (system_id, asset_type, serial_number, brand, model, capacity, equipment_type,
                      manufacture_date, service_interval_months, home_location_id)
  values (p_system_id, 'raft', trim(p_serial), nullif(trim(p_brand), ''), nullif(trim(p_model), ''),
          p_capacity, nullif(trim(p_equipment_type), ''), p_manufacture_date, p_interval_months, p_location)
  returning id into new_id;

  insert into asset_assignments (asset_id, customer_id, vessel_id, reason, created_by)
  values (new_id, p_customer, p_vessel, 'Registered at intake', auth.uid());

  insert into job_events (asset_id, customer_id, actor_id, source, action)
  values (new_id, p_customer, auth.uid(), 'web', 'asset_registered');
  return new_id;
end;
$$;

create function check_in_asset(
  p_asset uuid,
  p_location uuid,
  p_priority job_priority,
  p_estimate_required boolean,
  p_pickup_location text,
  p_dropped_off_by text,
  p_date_received date,
  p_notes text
) returns uuid
language plpgsql set search_path = public as $$
declare
  owner_id uuid;
  job uuid;
begin
  if not is_active_staff() then
    raise exception 'Only staff can check an asset in.';
  end if;
  if exists (select 1 from service_jobs j where j.asset_id = p_asset and j.closed_at is null) then
    raise exception 'This raft already has an open service job.';
  end if;
  if exists (select 1 from assets a where a.id = p_asset and a.retired) then
    raise exception 'This raft is marked retired. Clear that on the raft page before checking it in.';
  end if;
  select customer_id into owner_id from asset_assignments
   where asset_id = p_asset and effective_to is null;
  if owner_id is null then
    raise exception 'This raft has no owner yet. Set the owner before checking it in.';
  end if;

  insert into service_jobs (asset_id, location_id, stage, priority, estimate_status, pickup_location,
                            dropped_off_by, date_received, notes, billing_customer_id)
  values (p_asset, p_location, 'received', p_priority,
          case when p_estimate_required then 'required'::estimate_status else 'not_required'::estimate_status end,
          nullif(trim(p_pickup_location), ''), nullif(trim(p_dropped_off_by), ''),
          coalesce(p_date_received, current_date), nullif(trim(p_notes), ''), owner_id)
  returning id into job;

  insert into job_events (asset_id, job_id, customer_id, actor_id, source, action, to_stage)
  values (p_asset, job, owner_id, auth.uid(), 'web', 'checked_in', 'received');

  -- A raft that comes back in is no longer lapsed.
  update assets set lapsed = false where id = p_asset and lapsed;
  return job;
end;
$$;
