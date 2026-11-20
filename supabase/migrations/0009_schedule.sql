-- Scheduling a job (planned start and due dates) and each shop's turnaround figure.

alter table service_jobs add column scheduled_start date;
alter table service_jobs add column scheduled_due date;
alter table service_jobs add constraint service_jobs_schedule_order
  check (scheduled_start is null or scheduled_due is null or scheduled_due >= scheduled_start);

-- The turnaround a shop is quoting right now, set by hand until the calculated
-- figure has enough history behind it.
alter table locations add column turnaround_days integer check (turnaround_days between 0 and 365);
alter table locations add column turnaround_set_at timestamptz;
alter table locations add column turnaround_set_by uuid references staff (id);

-- Adds the schedule to the board. New columns go at the end of an existing view.
create or replace view job_board with (security_invoker = true) as
select
  j.id, j.job_number, j.stage, j.stage_before_side, j.priority, j.estimate_status, j.payment_status,
  j.date_received, j.location_id, l.name as location_name, j.notes, j.pickup_location,
  (j.payment_hold_override_by is not null) as payment_hold_acknowledged,
  coalesce(bc.payment_hold_exempt, false) as payment_hold_exempt,
  o.id as asset_id, o.serial_number, o.brand, o.capacity, o.equipment_type,
  o.customer_name, o.vessel_name, o.is_loaner,
  j.scheduled_start, j.scheduled_due
from service_jobs j
join asset_overview o on o.id = j.asset_id
join locations l on l.id = j.location_id
left join customers bc on bc.id = j.billing_customer_id
where j.closed_at is null;
