-- USCG service station notice, and approval numbers loaded from past inspections.

update locations set uscg_notice_email = 'msdportsmouthnh@uscg.mil' where code = 'york';
update locations set uscg_notice_email = 'SMB-USCGMSUBelfast@uscg.mil' where code = 'belfast';
alter table locations add column uscg_notice_cc text not null default 'service@survivalatsea.com';

update service_jobs set service_type = null where service_type not in ('Annual', '5-yr', 'Annual, FS, NAP');
alter table service_jobs add constraint service_jobs_service_type_check
  check (service_type is null or service_type in ('Annual', '5-yr', 'Annual, FS, NAP'));
alter table service_jobs add column uscg_notice_sent_at timestamptz;
alter table service_jobs add column uscg_notice_sent_by uuid references staff (id);

-- Fills in approval numbers from the old inspection records, without overwriting one a person entered.
create function import_set_approval_numbers(p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  update assets a set approval_number = x.approval_number
  from jsonb_to_recordset(p) as x(id uuid, approval_number text)
  where a.id = x.id and coalesce(a.approval_number, '') = '' and coalesce(x.approval_number, '') <> '';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function import_set_approval_numbers(jsonb) from public, anon, authenticated;
grant execute on function import_set_approval_numbers(jsonb) to service_role;
