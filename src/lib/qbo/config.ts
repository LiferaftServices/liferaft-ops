// Settings for the QuickBooks Online connection, read from the hosting environment.

export type QboEnvironment = "sandbox" | "production";

export interface QboConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QboEnvironment;
}

export const QBO_SCOPE = "com.intuit.quickbooks.accounting";
export const QBO_MINOR_VERSION = "75";

export const QBO_ENV_NAMES = [
  "QBO_CLIENT_ID",
  "QBO_CLIENT_SECRET",
  "QBO_REDIRECT_URI",
  "SUPABASE_SECRET_KEY",
] as const;

/** Names of required settings that are missing, so the settings page can say which. */
export function missingQboSettings(env: NodeJS.ProcessEnv = process.env): string[] {
  return QBO_ENV_NAMES.filter((name) => !env[name]);
}

export function qboConfig(env: NodeJS.ProcessEnv = process.env): QboConfig {
  const missing = missingQboSettings(env).filter((n) => n !== "SUPABASE_SECRET_KEY");
  if (missing.length) throw new Error(`Missing QuickBooks settings: ${missing.join(", ")}`);
  const environment = env.QBO_ENVIRONMENT === "production" ? "production" : "sandbox";
  return {
    clientId: env.QBO_CLIENT_ID!,
    clientSecret: env.QBO_CLIENT_SECRET!,
    redirectUri: env.QBO_REDIRECT_URI!,
    environment,
  };
}

export function apiBase(environment: QboEnvironment): string {
  return environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}
