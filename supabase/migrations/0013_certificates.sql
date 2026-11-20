-- The manufacturer's certificate line, added automatically for commercial rafts by brand.

-- Tidy brand spellings that mean the same brand. Plain "Revere", "Revere Com." and
-- "Revere (3Si/Ocean Safety)" are left as they are: which certificate they take is
-- not settled, so they get none automatically.
update assets set brand = case
  when lower(replace(replace(trim(brand), ' ', ''), '-', '')) in ('surviteczodiac', 'zodiac') then 'Survitec Zodiac'
  when lower(replace(replace(trim(brand), '-', ' '), '  ', ' ')) = 'rfd revere' then 'RFD Revere'
  when lower(trim(brand)) in ('revere (3si)', 'revere 3si', '3si') then 'Revere (3Si)'
  when lower(trim(brand)) in ('ssp', 'sspi') then 'SSP'
  when lower(trim(brand)) in ('crewsaver rec', 'crewsaver rec.') then 'Crewsaver Rec.'
  when lower(trim(brand)) in ('zodiac rec', 'zodiac rec.') then 'Zodiac Rec'
  when lower(trim(brand)) in ('revere rec', 'revere rec.') then 'Revere Rec.'
  when lower(trim(brand)) = 'elliot' then 'Elliot'
  when lower(trim(brand)) = 'crewsaver' then 'Crewsaver'
  when lower(trim(brand)) = 'rfd' then 'RFD'
  when lower(trim(brand)) = 'dbc' then 'DBC'
  when lower(trim(brand)) = 'dsb' then 'DSB'
  else trim(brand)
end
where asset_type = 'raft' and brand is not null;

create table certificate_items (
  brand text primary key,            -- exactly as chosen on the raft
  item_name text not null            -- the QuickBooks item name
);
alter table certificate_items enable row level security;
create policy certificate_items_staff_only on certificate_items
  for all to authenticated using (is_active_staff()) with check (is_active_staff());

insert into certificate_items (brand, item_name) values
  ('Crewsaver', '40-99999224'),
  ('DSB', '40-81800000'),
  ('Survitec Zodiac', 'DCG07020'),
  ('SSP', '40-99999SSP'),
  ('DBC', 'DCG07010'),
  ('RFD', '40-99999RFD'),
  ('Elliot', '40-99999ELL'),
  ('RFD Revere', '40-99999REV'),
  ('Revere (3Si)', 'OSL9810');

-- Recreational rafts get no certificate line.
create function is_recreational_raft(p_type text, p_brand text) returns boolean
language sql immutable as $$
  select trim(coalesce(p_type, '')) in ('Rec Coastal', 'Rec Offshore', '<24', '>24')
      or coalesce(p_brand, '') ~* '\mrec\M';
$$;

alter table job_lines drop constraint job_lines_source_check;
alter table job_lines add constraint job_lines_source_check
  check (source in ('scan', 'manual', 'standard', 'certificate'));

-- Adds the certificate line for a commercial raft whose brand has one. The brand must
-- match a rule exactly. Returns the item name, or null when nothing applies.
create function add_certificate_line(p_job uuid) returns text
language plpgsql set search_path = public as $$
declare
  wanted text;
  item text;
begin
  select ci.item_name into wanted
  from service_jobs j
  join assets a on a.id = j.asset_id
  join certificate_items ci on ci.brand = a.brand
  where j.id = p_job and a.asset_type = 'raft'
    and not is_recreational_raft(a.equipment_type, a.brand);
  if wanted is null then
    return null;
  end if;
  select qbo_id into item from qbo_items where lower(name) = lower(wanted) and active order by qbo_id limit 1;
  if item is null then
    return null;
  end if;
  if not exists (select 1 from job_lines where job_id = p_job and qbo_item_id = item) then
    perform add_job_line(p_job, item, 1, 'certificate');
  end if;
  return wanted;
end;
$$;

create or replace function service_jobs_standard_line() returns trigger
language plpgsql as $$
begin
  perform add_standard_service_line(new.id);
  perform add_certificate_line(new.id);
  return new;
end;
$$;
