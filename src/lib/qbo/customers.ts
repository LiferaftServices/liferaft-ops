// Turns a customer record as QuickBooks sends it into a row of our mirror table.
// Pure functions, so the mapping can be tested without a connection.

interface QboAddress {
  Line1?: string;
  Line2?: string;
  Line3?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
  Country?: string;
}

export interface QboCustomer {
  Id: string;
  SyncToken?: string;
  DisplayName?: string;
  FullyQualifiedName?: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
  Active?: boolean;
  Job?: boolean;
  Level?: number;
  ParentRef?: { value: string };
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  Mobile?: { FreeFormNumber?: string };
  BillAddr?: QboAddress;
  ShipAddr?: QboAddress;
  Balance?: number;
  Notes?: string;
  MetaData?: { LastUpdatedTime?: string };
}

export interface QboCustomerRow {
  qbo_id: string;
  display_name: string;
  fully_qualified_name: string;
  parent_qbo_id: string | null;
  level: number;
  active: boolean;
  company_name: string | null;
  given_name: string | null;
  family_name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  bill_address: Record<string, string> | null;
  ship_address: Record<string, string> | null;
  balance: number | null;
  notes: string | null;
  sync_token: string | null;
  qbo_updated_at: string | null;
  synced_at: string;
}

const clean = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

function address(a: QboAddress | undefined): Record<string, string> | null {
  if (!a) return null;
  const out: Record<string, string> = {};
  const lines = [a.Line1, a.Line2, a.Line3].map(clean).filter((l): l is string => !!l);
  if (lines.length) out.lines = lines.join("\n");
  if (clean(a.City)) out.city = a.City!.trim();
  if (clean(a.CountrySubDivisionCode)) out.state = a.CountrySubDivisionCode!.trim();
  if (clean(a.PostalCode)) out.postal_code = a.PostalCode!.trim();
  if (clean(a.Country)) out.country = a.Country!.trim();
  return Object.keys(out).length ? out : null;
}

export function toCustomerRow(c: QboCustomer, syncedAt: Date = new Date()): QboCustomerRow {
  const display = clean(c.DisplayName) ?? clean(c.FullyQualifiedName) ?? `Customer ${c.Id}`;
  return {
    qbo_id: c.Id,
    display_name: display,
    fully_qualified_name: clean(c.FullyQualifiedName) ?? display,
    parent_qbo_id: c.ParentRef?.value ?? null,
    level: c.Level ?? (c.ParentRef ? 1 : 0),
    active: c.Active ?? true,
    company_name: clean(c.CompanyName),
    given_name: clean(c.GivenName),
    family_name: clean(c.FamilyName),
    email: clean(c.PrimaryEmailAddr?.Address),
    phone: clean(c.PrimaryPhone?.FreeFormNumber),
    mobile: clean(c.Mobile?.FreeFormNumber),
    bill_address: address(c.BillAddr),
    ship_address: address(c.ShipAddr),
    balance: typeof c.Balance === "number" ? c.Balance : null,
    notes: clean(c.Notes),
    sync_token: c.SyncToken ?? null,
    qbo_updated_at: c.MetaData?.LastUpdatedTime ?? null,
    synced_at: syncedAt.toISOString(),
  };
}

/** The query for one page of customers, inactive ones included. Positions start at 1. */
export function customerPageQuery(startPosition: number, pageSize: number): string {
  return `select * from Customer where Active in (true, false) orderby Id startposition ${startPosition} maxresults ${pageSize}`;
}
