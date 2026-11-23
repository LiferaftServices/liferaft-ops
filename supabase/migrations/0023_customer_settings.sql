-- Per-customer switches, and a list of rafts whose QuickBooks customer has gone inactive
-- (usually because it was merged into another record there).

alter table customers add column no_reminders boolean not null default false;
alter table customers add column partner_account boolean not null default false;
alter table customers add column customer_type text check (customer_type in ('seasonal', 'full_time', 'recreational'));

create view assets_needing_relink with (security_invoker = true) as
select o.id, o.serial_number, o.brand, o.capacity, o.customer_name, o.customer_qbo_id, o.vessel_name, o.next_service_due
from asset_overview o
join qbo_customers q on q.qbo_id = o.customer_qbo_id
where not q.active and not o.retired;
