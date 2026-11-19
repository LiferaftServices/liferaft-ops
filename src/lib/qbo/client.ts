import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiBase, qboConfig, QBO_MINOR_VERSION, type QboEnvironment } from "./config";
import { customerPageQuery, toCustomerRow, type QboCustomer } from "./customers";
import { refreshTokens, type TokenSet } from "./oauth";

// Talks to the QuickBooks Online API as the connected company. Reads the stored
// tokens with the secret key, renews them when needed, and saves the renewal.

const PAGE_SIZE = 1000; // the most QuickBooks returns per query
const UPSERT_BATCH = 500;

interface Connection {
  environment: QboEnvironment;
  realmId: string;
  accessToken: string;
}

export class QboNotConnectedError extends Error {
  constructor() {
    super("QuickBooks is not connected.");
  }
}

export async function saveTokens(tokens: TokenSet): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("qbo_connection")
    .update({
      access_token: tokens.accessToken,
      access_expires_at: tokens.accessExpiresAt.toISOString(),
      refresh_token: tokens.refreshToken,
      refresh_expires_at: tokens.refreshExpiresAt?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) throw new Error(`Could not save QuickBooks tokens: ${error.message}`);
}

async function getConnection(): Promise<Connection> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("qbo_connection")
    .select("environment, realm_id, access_token, access_expires_at, refresh_token")
    .maybeSingle();
  if (error) throw new Error(`Could not read the QuickBooks connection: ${error.message}`);
  if (!data) throw new QboNotConnectedError();

  let accessToken: string = data.access_token;
  if (new Date(data.access_expires_at).getTime() <= Date.now()) {
    const renewed = await refreshTokens(qboConfig(), data.refresh_token);
    await saveTokens(renewed);
    accessToken = renewed.accessToken;
  }
  return { environment: data.environment, realmId: data.realm_id, accessToken };
}

async function qboFetch(conn: Connection, path: string, init?: RequestInit): Promise<unknown> {
  const joiner = path.includes("?") ? "&" : "?";
  const url = `${apiBase(conn.environment)}/v3/company/${conn.realmId}/${path}${joiner}minorversion=${QBO_MINOR_VERSION}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${conn.accessToken}`,
      Accept: "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`QuickBooks request failed (${res.status}): ${detail}`);
  }
  return res.json();
}

async function query<T>(conn: Connection, statement: string, entity: string): Promise<T[]> {
  const body = (await qboFetch(conn, "query", {
    method: "POST",
    headers: { "Content-Type": "application/text" },
    body: statement,
  })) as { QueryResponse?: Record<string, unknown> };
  return (body.QueryResponse?.[entity] as T[] | undefined) ?? [];
}

/** The connected company's name, straight from QuickBooks. */
export async function fetchCompanyName(
  environment: QboEnvironment,
  realmId: string,
  accessToken: string,
): Promise<string | null> {
  const body = (await qboFetch({ environment, realmId, accessToken }, `companyinfo/${realmId}`)) as {
    CompanyInfo?: { CompanyName?: string };
  };
  return body.CompanyInfo?.CompanyName ?? null;
}

/**
 * Copies every QuickBooks customer and sub-customer into the mirror table.
 * Read-only as far as QuickBooks is concerned. Returns how many were copied.
 */
export async function syncCustomers(): Promise<number> {
  const db = createAdminClient();
  try {
    const conn = await getConnection();
    const startedAt = new Date();
    let position = 1;
    let total = 0;
    for (;;) {
      const page = await query<QboCustomer>(conn, customerPageQuery(position, PAGE_SIZE), "Customer");
      const rows = page.map((c) => toCustomerRow(c, startedAt));
      for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
        const { error } = await db
          .from("qbo_customers")
          .upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict: "qbo_id" });
        if (error) throw new Error(`Could not save customers: ${error.message}`);
      }
      total += page.length;
      if (page.length < PAGE_SIZE) break;
      position += PAGE_SIZE;
    }
    // Anything not seen in this run no longer exists in QuickBooks (merged or deleted).
    const { error: pruneError } = await db
      .from("qbo_customers")
      .delete()
      .lt("synced_at", startedAt.toISOString());
    if (pruneError) throw new Error(`Could not remove stale customers: ${pruneError.message}`);

    await db
      .from("qbo_connection")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_count: total,
        last_sync_error: null,
      })
      .eq("id", true);
    return total;
  } catch (err) {
    if (!(err instanceof QboNotConnectedError)) {
      await db
        .from("qbo_connection")
        .update({ last_sync_error: err instanceof Error ? err.message : String(err) })
        .eq("id", true);
    }
    throw err;
  }
}
