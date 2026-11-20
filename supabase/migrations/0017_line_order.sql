-- Staff can put a job's lines in the order they like, and drop subtotal rows into the list.
-- The order carries through to the QuickBooks invoice; subtotal rows are for the screen only.

alter table job_lines add column position double precision;
update job_lines set position = extract(epoch from created_at)
  - case source when 'standard' then 2000000000 when 'certificate' then 1000000000 else 0 end;
alter table job_lines alter column position set not null;

-- New lines go to the end, except the labor line and the certificate, which lead the list.
create function job_lines_default_position() returns trigger
language plpgsql as $$
begin
  if new.position is null then
    new.position := extract(epoch from clock_timestamp())
      - case new.source when 'standard' then 2000000000 when 'certificate' then 1000000000 else 0 end;
  end if;
  return new;
end;
$$;
create trigger job_lines_position before insert on job_lines
  for each row execute function job_lines_default_position();
create index job_lines_order_idx on job_lines (job_id, position);

create table job_markers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references service_jobs (id) on delete cascade,
  kind text not null default 'subtotal' check (kind in ('subtotal')),
  position double precision not null default extract(epoch from clock_timestamp()),
  created_by uuid references staff (id),
  created_at timestamptz not null default now()
);
create index job_markers_job_idx on job_markers (job_id, position);
alter table job_markers enable row level security;
create policy job_markers_staff_only on job_markers
  for all to authenticated using (is_active_staff()) with check (is_active_staff());

-- Saves the order of a job's rows. p_ids lists line ids and subtotal-row ids, top to bottom.
-- Lines already on a QuickBooks invoice keep their place.
create function set_job_order(p_job uuid, p_ids uuid[]) returns void
language plpgsql set search_path = public as $$
begin
  if not is_active_staff() then
    raise exception 'Only staff can reorder a job.';
  end if;
  if not exists (select 1 from service_jobs j where j.id = p_job and j.closed_at is null and j.qbo_invoice_id is null) then
    raise exception 'This job is closed or already invoiced.';
  end if;
  update job_lines set position = array_position(p_ids, id)
   where job_id = p_job and invoice_id is null and id = any (p_ids);
  update job_markers set position = array_position(p_ids, id)
   where job_id = p_job and id = any (p_ids);
end;
$$;
