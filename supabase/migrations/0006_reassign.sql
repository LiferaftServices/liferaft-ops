-- Moving an asset to a different owner or vessel, as one all-or-nothing step.
-- The old ownership record is closed, never edited or removed, so history is kept.

create function reassign_asset(
  p_asset uuid,
  p_customer uuid,
  p_vessel uuid,
  p_reason text
) returns uuid
language plpgsql set search_path = public as $$
declare
  cur asset_assignments%rowtype;
  at_time timestamptz := now();
  new_id uuid;
begin
  if not is_active_staff() then
    raise exception 'Only staff can reassign an asset.';
  end if;
  if p_vessel is not null and not exists (
    select 1 from vessels v where v.id = p_vessel
  ) then
    raise exception 'That vessel does not exist.';
  end if;

  select * into cur from asset_assignments
   where asset_id = p_asset and effective_to is null for update;

  if found then
    if cur.customer_id = p_customer and cur.vessel_id is not distinct from p_vessel then
      return cur.id;  -- nothing to change
    end if;
    -- The closing time must fall after the opening time.
    at_time := greatest(at_time, cur.effective_from + interval '1 second');
    update asset_assignments set effective_to = at_time where id = cur.id;
  end if;

  insert into asset_assignments (asset_id, customer_id, vessel_id, effective_from, reason, created_by)
  values (p_asset, p_customer, p_vessel, at_time, nullif(trim(p_reason), ''), auth.uid())
  returning id into new_id;

  update assets set revision = revision + 1 where id = p_asset;
  return new_id;
end;
$$;
