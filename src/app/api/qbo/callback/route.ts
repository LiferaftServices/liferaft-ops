import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { fetchCompanyName } from "@/lib/qbo/client";
import { missingQboSettings, qboConfig } from "@/lib/qbo/config";
import { exchangeCode } from "@/lib/qbo/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

const STATE_COOKIE = "qbo_oauth_state";

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Intuit sends the admin back here after they approve (or refuse) the connection.
export async function GET(request: NextRequest) {
  // Reading the session first also marks this route as per-request.
  const session = await getSession();
  if (session.status !== "staff" || session.staff.role !== "admin") {
    return new NextResponse("Only an admin can connect QuickBooks.", { status: 403 });
  }
  if (missingQboSettings().length) {
    return new NextResponse("QuickBooks settings are missing on the server.", { status: 500 });
  }
  const config = qboConfig();
  // Build the return address from the registered one: behind the host's proxy
  // the request's own address is an internal one.
  const back = (result: string) =>
    NextResponse.redirect(new URL(`/settings/quickbooks?result=${result}`, config.redirectUri));

  const params = request.nextUrl.searchParams;
  const cookieStore = await cookies();
  const expected = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete({ name: STATE_COOKIE, path: "/api/qbo" });

  if (params.get("error")) return back("declined");
  const code = params.get("code");
  const realmId = params.get("realmId");
  const state = params.get("state");
  if (!code || !realmId || !state || !expected || !sameState(state, expected)) {
    return back("invalid");
  }

  try {
    const tokens = await exchangeCode(config, code);
    const companyName = await fetchCompanyName(config.environment, realmId, tokens.accessToken).catch(
      () => null,
    );
    const db = createAdminClient();
    const { error } = await db.from("qbo_connection").upsert({
      id: true,
      environment: config.environment,
      realm_id: realmId,
      company_name: companyName,
      access_token: tokens.accessToken,
      access_expires_at: tokens.accessExpiresAt.toISOString(),
      refresh_token: tokens.refreshToken,
      refresh_expires_at: tokens.refreshExpiresAt?.toISOString() ?? null,
      connected_by: session.staff.id,
      connected_at: new Date().toISOString(),
      last_sync_at: null,
      last_sync_count: null,
      last_sync_error: null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error("QuickBooks connection failed:", err instanceof Error ? err.message : err);
    return back("failed");
  }
  return back("connected");
}
