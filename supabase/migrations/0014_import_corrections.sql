-- Corrections to imported data. These run only from the server's import, never from
-- a staff login, and each leaves alone anything a person has since changed in the system.

-- Corrects service dates (and retires records that are not real rafts). A raft that has
-- had a job in this system keeps its dates: the system's own record is newer.
create function import_apply_asset_corrections(p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  update assets a set
    last_serviced_on = x.last_serviced_on,
    next_service_due = x.next_service_due,
    lapsed = coalesce(x.lapsed, a.lapsed),
    retired = a.retired or coalesce(x.retired, false),
    retired_reason = case when coalesce(x.retired, false) and not a.retired then x.retired_reason else a.retired_reason end
  from jsonb_to_recordset(p) as x(
    id uuid, last_serviced_on date, next_service_due date, lapsed boolean, retired boolean, retired_reason text
  )
  where a.id = x.id
    and not exists (select 1 from service_jobs j where j.asset_id = a.id);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Removes the service history that came from the import, so a corrected copy can be
-- loaded. Services recorded by this system are kept.
create function import_clear_history() returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  delete from service_history where source in ('quickbooks', 'asana', 'fastfield');
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Removes imported ownership records for the given assets so corrected ones can be
-- loaded. An asset is skipped, and its id not returned, if anyone has reassigned it
-- in the system or it has had a job.
create function import_reset_assignments(p uuid[]) returns uuid[]
language plpgsql security definer set search_path = public as $$
declare
  ok uuid[];
begin
  select coalesce(array_agg(a), '{}') into ok
  from unnest(p) as a
  where not exists (
          select 1 from asset_assignments aa
          where aa.asset_id = a and (aa.reason is null or aa.reason not like 'Imported%')
        )
    and not exists (select 1 from service_jobs j where j.asset_id = a);
  delete from asset_assignments where asset_id = any(ok);
  return ok;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'import_apply_asset_corrections(jsonb)', 'import_clear_history()', 'import_reset_assignments(uuid[])'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end;
$$;
