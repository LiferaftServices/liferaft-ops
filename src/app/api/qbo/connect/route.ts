import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { missingQboSettings, qboConfig } from "@/lib/qbo/config";
import { authorizeUrl, getEndpoints } from "@/lib/qbo/oauth";

const STATE_COOKIE = "qbo_oauth_state";

// Starts the QuickBooks connection: sends an admin to Intuit to approve it.
export async function GET() {
  const session = await getSession();
  if (session.status !== "staff" || session.staff.role !== "admin") {
    return new NextResponse("Only an admin can connect QuickBooks.", { status: 403 });
  }
  if (missingQboSettings().length) {
    return new NextResponse("QuickBooks settings are missing on the server.", { status: 500 });
  }
  const config = qboConfig();
  const state = randomBytes(24).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: config.redirectUri.startsWith("https://"),
    sameSite: "lax",
    path: "/api/qbo",
    maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl(config, state, await getEndpoints(config)));
}
