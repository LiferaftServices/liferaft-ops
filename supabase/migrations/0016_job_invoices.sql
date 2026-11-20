-- A job can have more than one QuickBooks invoice: the service invoice, plus separate
-- invoices for items added afterwards. An invoice that has gone to QuickBooks is never
-- edited from here, because SOS Inventory has already built its shipment from it.

create table job_invoices (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references service_jobs (id) on delete cascade,
  qbo_invoice_id text not null unique,
  doc_number text,
  kind text not null check (kind in ('service', 'additional')),
  total_sent numeric(12, 2) not null,     -- what QuickBooks returned when we created it
  lines_sent integer not null,
  total numeric(12, 2) not null,          -- what QuickBooks shows now
  lines_now integer not null,
  balance numeric(12, 2) not null,
  changed_in_qbo boolean not null default false,
  created_by uuid references staff (id),
  created_at timestamptz not null default now(),
  checked_at timestamptz
);
create index job_invoices_job_idx on job_invoices (job_id, created_at);
alter table job_invoices enable row level security;
create policy job_invoices_staff_only on job_invoices
  for all to authenticated using (is_active_staff()) with check (is_active_staff());

alter table job_lines add column invoice_id uuid references job_invoices (id);
alter table service_jobs add column extra_invoice_claimed_at timestamptz;

-- Invoices created before this table existed.
insert into job_invoices (job_id, qbo_invoice_id, doc_number, kind, total_sent, lines_sent, total, lines_now, balance, created_by, created_at, checked_at)
select j.id, j.qbo_invoice_id, j.qbo_invoice_number, 'service', coalesce(j.invoice_total, 0), n.c, coalesce(j.invoice_total, 0), n.c,
       coalesce(j.invoice_balance, 0), j.invoiced_by, coalesce(j.invoiced_at, now()), j.payment_checked_at
from service_jobs j
cross join lateral (
  select count(*)::int + case when coalesce(j.discount_percent, 0) > 0 then 2 else 0 end as c
  from job_lines l where l.job_id = j.id
) n
where j.qbo_invoice_id is not null;

update job_lines l set invoice_id = i.id
from job_invoices i where i.job_id = l.job_id and l.invoice_id is null;

-- Parts can now be added after the service invoice; they wait for an additional invoice.
-- Lines already on an invoice are never touched.
create or replace function add_job_line(
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
  if not exists (select 1 from service_jobs j where j.id = p_job and j.closed_at is null) then
    raise exception 'This job is closed.';
  end if;
  select * into it from qbo_items where qbo_id = p_item and active;
  if not found then
    raise exception 'That item is not an active QuickBooks item.';
  end if;

  select id into line from job_lines
   where job_id = p_job and qbo_item_id = p_item and invoice_id is null for update;
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

-- One person at a time may create an additional invoice for a job.
create function claim_job_for_additional_invoice(p_job uuid) returns boolean
language plpgsql set search_path = public as $$
declare
  n integer;
begin
  if not is_active_staff() then
    raise exception 'Only staff can invoice a job.';
  end if;
  update service_jobs set extra_invoice_claimed_at = now()
   where id = p_job and closed_at is null and qbo_invoice_id is not null
     and (extra_invoice_claimed_at is null or extra_invoice_claimed_at < now() - interval '2 minutes')
     and exists (select 1 from job_lines l where l.job_id = p_job and l.invoice_id is null);
  get diagnostics n = row_count;
  return n = 1;
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
  exists (select 1 from job_lines x where x.job_id = j.id and x.invoice_id is null and j.qbo_invoice_id is not null) as has_uninvoiced_items
from service_jobs j
join asset_overview o on o.id = j.asset_id
join locations l on l.id = j.location_id
left join customers bc on bc.id = j.billing_customer_id
where j.closed_at is null;
