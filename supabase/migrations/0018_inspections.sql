-- The inspection record for a job. Each field is saved on its own, so several people on
-- several devices can fill in the same inspection without overwriting one another.

create table inspections (
  job_id uuid primary key references service_jobs (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references staff (id)
);
alter table inspections enable row level security;
create policy inspections_staff_only on inspections
  for all to authenticated using (is_active_staff()) with check (is_active_staff());

-- Saves one or more fields. A null value clears that field.
create function save_inspection_fields(p_job uuid, p_patch jsonb) returns void
language plpgsql set search_path = public as $$
begin
  if not is_active_staff() then
    raise exception 'Only staff can fill in an inspection.';
  end if;
  if not exists (select 1 from service_jobs j where j.id = p_job and j.closed_at is null) then
    raise exception 'This job is closed.';
  end if;
  insert into inspections (job_id, data, updated_by)
  values (p_job, jsonb_strip_nulls(p_patch), auth.uid())
  on conflict (job_id) do update
    set data = jsonb_strip_nulls(inspections.data || p_patch), updated_at = now(), updated_by = auth.uid();
end;
$$;

-- After an inspection is signed off, use the dates the technician entered: the day the
-- work was done, and the month the raft is dated as (up to six months later, while the
-- raft stays in the shop). Next service is due at the end of that month, one interval on.
create function apply_inspection_dates(p_job uuid) returns void
language plpgsql set search_path = public as $$
declare
  j service_jobs%rowtype;
  d jsonb;
  worked date;
  dated date;
  months integer;
begin
  if not is_active_staff() then
    raise exception 'Only staff can do this.';
  end if;
  select * into j from service_jobs where id = p_job;
  select data into d from inspections where job_id = p_job;
  if not found or d is null then return; end if;
  worked := coalesce(nullif(d->>'work_date', '')::date, current_date);
  if worked > current_date then worked := current_date; end if;
  dated := coalesce(to_date(nullif(d->>'dated_as', ''), 'YYYY-MM'), date_trunc('month', worked)::date);
  if dated < date_trunc('month', worked)::date or dated > (date_trunc('month', worked) + interval '6 months')::date then
    dated := date_trunc('month', worked)::date;
  end if;
  select coalesce(service_interval_months, 12) into months from assets where id = j.asset_id;
  update service_history set serviced_on = worked where job_id = p_job and source = 'system';
  update assets set
    last_serviced_on = worked,
    next_service_due = (dated + make_interval(months => months + 1) - interval '1 day')::date
  where id = j.asset_id;
end;
$$;
