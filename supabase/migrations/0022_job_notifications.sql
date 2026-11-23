-- A record of each customer message a person prepared from a job, so the office can see
-- what the customer has been told and when. Nothing is sent automatically.
create table job_notifications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references service_jobs (id) on delete cascade,
  kind text not null,
  channel text not null default 'email' check (channel in ('email', 'text')),
  recipient text not null,
  created_by uuid references staff (id),
  created_at timestamptz not null default now()
);
create index job_notifications_job_idx on job_notifications (job_id, created_at);
alter table job_notifications enable row level security;
create policy job_notifications_staff_only on job_notifications
  for all to authenticated using (is_active_staff()) with check (is_active_staff());
