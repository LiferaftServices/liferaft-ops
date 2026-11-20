-- Parts on a job: a copy of the QuickBooks item list, the table that turns a
-- scanned label into a part number, and the lines recorded against each job.

create table qbo_items (
  qbo_id text primary key,
  name text not null,
  fully_qualified_name text not null,
  sku text,
  description text,
  unit_price numeric(12, 4),
  taxable boolean not null default false,
  item_type text,
  active boolean not null default true,
  synced_at timestamptz not null default now()
);
create index qbo_items_name_idx on qbo_items (lower(name));
alter table qbo_items enable row level security;
create policy qbo_items_staff_read on qbo_items for select to authenticated using (is_active_staff());

-- What a label says when scanned, and the part number it stands for. Older labels
-- carry a code from the previous inventory system; newer ones carry the part number.
create table part_codes (
  code text primary key,
  part_number text not null,
  source text not null default 'import',
  created_by uuid references staff (id),
  created_at timestamptz not null default now()
);
alter table part_codes enable row level security;
create policy part_codes_staff_only on part_codes
  for all to authenticated using (is_active_staff()) with check (is_active_staff());

create table job_lines (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references service_jobs (id) on delete cascade,
  qbo_item_id text not null,
  part_number text not null,
  description text,
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  unit_price numeric(12, 4) not null default 0,   -- price when added; QuickBooks is checked again at invoicing
  taxable boolean not null default false,
  source text not null default 'manual' check (source in ('scan', 'manual', 'standard')),
  added_by uuid references staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_lines_job_idx on job_lines (job_id, created_at);
alter table job_lines enable row level security;
create policy job_lines_staff_only on job_lines
  for all to authenticated using (is_active_staff()) with check (is_active_staff());

-- Adds a part to an open job, or raises the quantity if it is already there.
create function add_job_line(
  p_job uuid,
  p_item text,
  p_quantity numeric,
  p_source text
) returns uuid
language plpgsql set search_path = public as $$
declare
  it qbo_items%rowtype;
  line uuid;
begin
  if not is_active_staff() then
    raise exception 'Only staff can add parts.';
  end if;
  if not exists (select 1 from service_jobs j where j.id = p_job and j.closed_at is null and j.qbo_invoice_id is null) then
    raise exception 'This job is closed or already invoiced.';
  end if;
  select * into it from qbo_items where qbo_id = p_item and active;
  if not found then
    raise exception 'That item is not an active QuickBooks item.';
  end if;

  select id into line from job_lines where job_id = p_job and qbo_item_id = p_item for update;
  if found then
    update job_lines set quantity = quantity + p_quantity, updated_at = now() where id = line;
  else
    insert into job_lines (job_id, qbo_item_id, part_number, description, quantity, unit_price, taxable, source, added_by)
    values (p_job, it.qbo_id, it.name, it.description, p_quantity, coalesce(it.unit_price, 0), it.taxable, p_source, auth.uid())
    returning id into line;
  end if;
  return line;
end;
$$;
