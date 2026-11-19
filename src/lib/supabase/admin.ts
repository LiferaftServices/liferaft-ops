import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

/**
 * A database client that uses the secret key and so bypasses row security.
 * Server only. Used for the few things no staff login may touch directly:
 * the QuickBooks tokens and writing the QuickBooks customer mirror.
 */
export function createAdminClient() {
  const { url } = supabaseConfig();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    throw new Error("SUPABASE_SECRET_KEY is not set. Add it in the hosting settings.");
  }
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
