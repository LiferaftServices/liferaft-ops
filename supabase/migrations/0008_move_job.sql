-- Moving a service job from one stage to the next, as one all-or-nothing step.
-- Which moves are allowed is decided by the workflow rules in the app (and tested
-- there); this function makes the change safely: it refuses if the job is no longer
-- where the person saw it, and it always writes the event log entry with the change.

create function move_job(
  p_job uuid,
  p_from job_stage,
  p_to job_stage,
  p_action text,
  p_closes boolean,
  p_stage_before_side job_stage,
  p_estimate_status estimate_status,
  p_note text
) returns void
language plpgsql set search_path = public as $$
declare
  j service_jobs%rowtype;
  months integer;
begin
  if not is_active_staff() then
    raise exception 'Only staff can move a job.';
  end if;
  select * into j from service_jobs where id = p_job for update;
  if not found or j.closed_at is not null then
    raise exception 'This job is closed or does not exist.';
  end if;
  if j.stage <> p_from then
    raise exception 'This job has already moved. Refresh the page and try again.';
  end if;

  update service_jobs set
    stage = p_to,
    stage_before_side = p_stage_before_side,
    estimate_status = coalesce(p_estimate_status, estimate_status),
    technician_id = case when p_action = 'begin_service' then auth.uid() else technician_id end,
    closed_at = case when p_closes then now() else null end,
    revision = revision + 1
  where id = p_job;

  insert into job_events (asset_id, job_id, customer_id, actor_id, source, action, from_stage, to_stage, note)
  values (j.asset_id, j.id, j.billing_customer_id, auth.uid(), 'web', p_action, p_from, p_to, nullif(trim(p_note), ''));

  -- Signing off the inspection is the service: record it and set the next due date.
  if p_action = 'complete_inspection' then
    select coalesce(service_interval_months, 12) into months from assets where id = j.asset_id;
    insert into service_history (asset_id, serviced_on, source, location_id, reference, job_id)
    values (j.asset_id, current_date, 'system', j.location_id, j.job_number, j.id);
    update assets set
      last_serviced_on = current_date,
      next_service_due = (current_date + make_interval(months => months))::date,
      lapsed = false,
      confirmed = true
    where id = j.asset_id;
  end if;
end;
$$;

-- One row per open job with what the service board shows.
create view job_board with (security_invoker = true) as
select
  j.id, j.job_number, j.stage, j.stage_before_side, j.priority, j.estimate_status, j.payment_status,
  j.date_received, j.location_id, l.name as location_name, j.notes, j.pickup_location,
  (j.payment_hold_override_by is not null) as payment_hold_acknowledged,
  coalesce(bc.payment_hold_exempt, false) as payment_hold_exempt,
  o.id as asset_id, o.serial_number, o.brand, o.capacity, o.equipment_type,
  o.customer_name, o.vessel_name, o.is_loaner
from service_jobs j
join asset_overview o on o.id = j.asset_id
join locations l on l.id = j.location_id
left join customers bc on bc.id = j.billing_customer_id
where j.closed_at is null;
