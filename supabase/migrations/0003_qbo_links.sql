-- QuickBooks links for vessels and assets.
--
-- In QuickBooks today a vessel, and sometimes an individual raft, is its own
-- sub-customer record (Parent > Vessel > Serial number). In this system those are
-- vessels and assets, not customers, but the link to the QuickBooks record is kept
-- so an invoice can post to the most specific record that exists there: the raft's
-- own record under its current owner, otherwise the vessel's, otherwise the account's.

alter table customers add column qbo_full_name text;      -- 'Parent:Child' name as exported from QuickBooks
alter table vessels   add column qbo_customer_id text unique;
alter table vessels   add column qbo_full_name text;

-- A raft's own QuickBooks record belongs to one owner's account, so the link sits on
-- the ownership record, not on the raft. When the raft is sold the old link ends with
-- the old ownership and the new owner's records take over.
alter table asset_assignments add column qbo_customer_id text;
alter table asset_assignments add column qbo_full_name text;
create unique index asset_assignments_qbo_current on asset_assignments (qbo_customer_id)
  where effective_to is null and qbo_customer_id is not null;

-- Vessel and raft details copied from QuickBooks invoices can be stale, because
-- QuickBooks carries them forward from one invoice to the next. Records built
-- from that source stay marked until an Asana or FastField record confirms them.
alter table vessels add column confirmed boolean not null default true;
alter table assets  add column confirmed boolean not null default true;

-- The QuickBooks record an invoice for this asset should post to.
create function invoice_qbo_customer_id(p_asset_id uuid) returns text
language sql stable set search_path = public as $$
  select coalesce(aa.qbo_customer_id, v.qbo_customer_id, c.qbo_customer_id)
  from assets a
  left join asset_assignments aa on aa.asset_id = a.id and aa.effective_to is null
  left join vessels v on v.id = aa.vessel_id
  left join customers c on c.id = aa.customer_id
  where a.id = p_asset_id;
$$;
