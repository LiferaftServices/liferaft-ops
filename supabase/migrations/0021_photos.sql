-- Photos taken during a job: the serial number, the painter connections, the delivery.
-- The pictures live in private file storage; this table says which job each belongs to.

create table job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references service_jobs (id) on delete cascade,
  asset_id uuid not null references assets (id),
  kind text not null check (kind in ('serial', 'painter_op_head', 'painter_raft', 'delivery', 'other')),
  path text not null unique,
  created_by uuid references staff (id),
  created_at timestamptz not null default now()
);
create index job_photos_job_idx on job_photos (job_id, created_at);
create index job_photos_asset_idx on job_photos (asset_id, created_at desc);
alter table job_photos enable row level security;
create policy job_photos_staff_only on job_photos
  for all to authenticated using (is_active_staff()) with check (is_active_staff());

-- The private bucket, readable and writable by signed-in staff only. (Skipped where there
-- is no file storage, as in the automated tests.)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $q$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('job-photos', 'job-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
      on conflict (id) do nothing$q$;
    execute $q$create policy job_photos_read on storage.objects for select to authenticated
      using (bucket_id = 'job-photos' and public.is_active_staff())$q$;
    execute $q$create policy job_photos_add on storage.objects for insert to authenticated
      with check (bucket_id = 'job-photos' and public.is_active_staff())$q$;
    execute $q$create policy job_photos_remove on storage.objects for delete to authenticated
      using (bucket_id = 'job-photos' and public.is_active_staff())$q$;
  end if;
end;
$$;
