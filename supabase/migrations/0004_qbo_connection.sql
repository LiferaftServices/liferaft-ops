-- The live link to QuickBooks Online, and a mirror of its customer list.
--
-- qbo_connection holds the sign-in tokens for the one connected company. It has
-- row security on and NO policy, so staff logins cannot read it at all. Only the
-- server, using the database's secret key, can.
--
-- qbo_customers is a read-only copy of every QuickBooks customer and sub-customer,
-- refreshed by the sync. QuickBooks stays the source of truth; this copy is what
-- search and the customer tree read from.

create table qbo_connection (
  id boolean primary key default true check (id),
  environment text not null check (environment in ('sandbox', 'production')),
  realm_id text not null,
  company_name text,
  access_token text not null,
  access_expires_at timestamptz not null,
  refresh_token text not null,
  refresh_expires_at timestamptz,
  connected_by uuid references staff(id),
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_sync_count integer,
  last_sync_error text,
  updated_at timestamptz not null default now()
);

alter table qbo_connection enable row level security;

-- What staff may see about the connection: everything except the tokens.
create function qbo_connection_status()
returns table (
  environment text,
  realm_id text,
  company_name text,
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_sync_count integer,
  last_sync_error text
)
language sql stable security definer set search_path = public as $$
  select c.environment, c.realm_id, c.company_name, c.connected_at,
         c.last_sync_at, c.last_sync_count, c.last_sync_error
  from qbo_connection c
  where is_active_staff();
$$;

create table qbo_customers (
  qbo_id text primary key,
  display_name text not null,
  fully_qualified_name text not null,
  parent_qbo_id text,
  level integer not null default 0,
  active boolean not null default true,
  company_name text,
  given_name text,
  family_name text,
  email text,
  phone text,
  mobile text,
  bill_address jsonb,
  ship_address jsonb,
  balance numeric(12, 2),
  notes text,
  sync_token text,
  qbo_updated_at timestamptz,
  synced_at timestamptz not null default now()
);

create index qbo_customers_parent_idx on qbo_customers (parent_qbo_id);
create index qbo_customers_name_idx on qbo_customers (lower(fully_qualified_name));

alter table qbo_customers enable row level security;

-- Staff can read the mirror. Nobody writes to it except the server's sync.
create policy qbo_customers_staff_read on qbo_customers
  for select to authenticated using (is_active_staff());

-- Belt and braces: take away table privileges on the token table from the
-- browser-facing roles, where those roles exist (they do on the hosted database).
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on qbo_connection from %I', r);
    end if;
  end loop;
end;
$$;
