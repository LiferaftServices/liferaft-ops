-- Invoicing: what was created in QuickBooks for a job, and the payment hold.

alter table service_jobs add column qbo_invoice_number text;
alter table service_jobs add column invoice_total numeric(12, 2);
alter table service_jobs add column invoice_balance numeric(12, 2);
alter table service_jobs add column invoiced_at timestamptz;
alter table service_jobs add column invoiced_by uuid references staff (id);
alter table service_jobs add column discount_percent numeric(5, 2) check (discount_percent between 0 and 100);
alter table service_jobs add column payment_checked_at timestamptz;

-- Marks a job as being invoiced, so two people cannot create two invoices for it.
-- Returns true only for the caller who gets to proceed.
create function claim_job_for_invoice(p_job uuid) returns boolean
language plpgsql set search_path = public as $$
declare
  n integer;
begin
  if not is_active_staff() then
    raise exception 'Only staff can invoice a job.';
  end if;
  update service_jobs set invoiced_at = now(), invoiced_by = auth.uid()
   where id = p_job and closed_at is null and stage = 'needs_invoice'
     and qbo_invoice_id is null
     and (invoiced_at is null or invoiced_at < now() - interval '2 minutes');
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
  j.qbo_invoice_id, j.qbo_invoice_number, j.invoice_total, j.invoice_balance
from service_jobs j
join asset_overview o on o.id = j.asset_id
join locations l on l.id = j.location_id
left join customers bc on bc.id = j.billing_customer_id
where j.closed_at is null;
