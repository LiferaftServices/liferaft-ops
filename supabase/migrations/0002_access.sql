-- Access rules: only signed-in, active staff can read or change anything.
-- Admin-only actions (managing staff, overriding rules) are enforced in the app layer on top of this.

create function is_active_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff where id = auth.uid() and active
  );
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'locations', 'staff', 'customers', 'contacts', 'vessels', 'vessel_gear',
    'assets', 'asset_set_items', 'asset_assignments', 'service_jobs', 'job_events',
    'loans', 'loan_waitlist', 'saved_places', 'routes', 'route_stops'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for all to authenticated using (is_active_staff()) with check (is_active_staff())',
      t || '_staff_only', t
    );
  end loop;
end;
$$;
