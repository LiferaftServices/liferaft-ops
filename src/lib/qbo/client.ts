import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiBase, qboConfig, QBO_MINOR_VERSION, type QboEnvironment } from "./config";
import { customerPageQuery, toCustomerRow, type QboCustomer } from "./customers";
import { QboReconnectError, refreshTokens, type TokenSet } from "./oauth";

// Talks to the QuickBooks Online API as the connected company. Reads the stored
// tokens with the secret key, renews them when needed, and saves the renewal.

const PAGE_SIZE = 1000; // the most QuickBooks returns per query
const UPSERT_BATCH = 500;

interface Connection {
  environment: QboEnvironment;
  realmId: string;
  accessToken: string;
  refreshToken?: string;
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
  let refreshToken: string = data.refresh_token;
  if (new Date(data.access_expires_at).getTime() <= Date.now()) {
    const renewed = await renew(refreshToken);
    accessToken = renewed.accessToken;
    refreshToken = renewed.refreshToken;
  }
  return { environment: data.environment, realmId: data.realm_id, accessToken, refreshToken };
}

/**
 * Renews the tokens and saves them. If Intuit says the sign-in is no longer valid
 * (expired or revoked refresh token), the dead connection is removed so the
 * QuickBooks page asks an admin to connect again.
 */
async function renew(refreshToken: string): Promise<TokenSet> {
  try {
    const renewed = await refreshTokens(qboConfig(), refreshToken);
    await saveTokens(renewed);
    return renewed;
  } catch (err) {
    if (err instanceof QboReconnectError) {
      await createAdminClient().from("qbo_connection").delete().eq("id", true);
    }
    throw err;
  }
}

async function qboFetch(conn: Connection, path: string, init?: RequestInit): Promise<unknown> {
  const joiner = path.includes("?") ? "&" : "?";
  const url = `${apiBase(conn.environment)}/v3/company/${conn.realmId}/${path}${joiner}minorversion=${QBO_MINOR_VERSION}`;
  const send = () =>
    fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${conn.accessToken}`,
        Accept: "application/json",
        ...init?.headers,
      },
      cache: "no-store",
    });
  let res = await send();
  // 401: the access token was rejected. Renew it once and try again.
  if (res.status === 401 && conn.refreshToken) {
    const renewed = await renew(conn.refreshToken);
    conn.accessToken = renewed.accessToken;
    conn.refreshToken = renewed.refreshToken;
    res = await send();
  }
  if (res.status === 401) throw new QboReconnectError();
  // 429: QuickBooks is asking us to slow down. Wait and try once more.
  if (res.status === 429) {
    const wait = Math.min(Number(res.headers.get("Retry-After")) || 5, 30);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    res = await send();
  }
  if (!res.ok) {
    const tid = res.headers.get("intuit_tid");
    const detail = (await res.text()).slice(0, 300);
    // Intuit's transaction id is what their support asks for when tracing a problem.
    console.error(`QuickBooks request failed: status=${res.status} intuit_tid=${tid ?? "none"} path=${path}`);
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
    if (!(err instanceof QboNotConnectedError) && !(err instanceof QboReconnectError)) {
      await db
        .from("qbo_connection")
        .update({ last_sync_error: err instanceof Error ? err.message : String(err) })
        .eq("id", true);
    }
    throw err;
  }
}
