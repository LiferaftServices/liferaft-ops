// The sign-in handshake with Intuit (OAuth 2.0).

import { QBO_SCOPE, type QboConfig } from "./config";

// Intuit publishes its current sign-in addresses in a "discovery document".
// These are used, with the long-standing addresses below as the fallback if the
// document cannot be fetched.
const DISCOVERY_URLS = {
  sandbox: "https://developer.api.intuit.com/.well-known/openid_sandbox_configuration",
  production: "https://developer.api.intuit.com/.well-known/openid_configuration",
} as const;

export interface Endpoints {
  authorize: string;
  token: string;
  revoke: string;
}

export const DEFAULT_ENDPOINTS: Endpoints = {
  authorize: "https://appcenter.intuit.com/connect/oauth2",
  token: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revoke: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
};

const isIntuit = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)intuit\.com$/.test(url.hostname);
  } catch {
    return false;
  }
};

/** Picks the endpoints out of a discovery document, ignoring anything not on intuit.com. */
export function endpointsFromDiscovery(doc: unknown): Endpoints {
  const d = (doc ?? {}) as Record<string, unknown>;
  return {
    authorize: isIntuit(d.authorization_endpoint) ? d.authorization_endpoint : DEFAULT_ENDPOINTS.authorize,
    token: isIntuit(d.token_endpoint) ? d.token_endpoint : DEFAULT_ENDPOINTS.token,
    revoke: isIntuit(d.revocation_endpoint) ? d.revocation_endpoint : DEFAULT_ENDPOINTS.revoke,
  };
}

const cached = new Map<string, { at: number; endpoints: Endpoints }>();
const DAY = 24 * 60 * 60 * 1000;

export async function getEndpoints(config: QboConfig): Promise<Endpoints> {
  const hit = cached.get(config.environment);
  if (hit && Date.now() - hit.at < DAY) return hit.endpoints;
  try {
    const res = await fetch(DISCOVERY_URLS[config.environment], {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const endpoints = endpointsFromDiscovery(await res.json());
    cached.set(config.environment, { at: Date.now(), endpoints });
    return endpoints;
  } catch {
    return DEFAULT_ENDPOINTS;
  }
}

/** The sign-in was refused for good (expired or revoked): a person must connect again. */
export class QboReconnectError extends Error {
  constructor() {
    super("The QuickBooks sign-in has expired or was revoked. An admin needs to connect QuickBooks again.");
  }
}

export interface TokenSet {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date | null;
}

/** Where to send an admin's browser to approve the connection. */
export function authorizeUrl(
  config: QboConfig,
  state: string,
  endpoints: Endpoints = DEFAULT_ENDPOINTS,
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: QBO_SCOPE,
    redirect_uri: config.redirectUri,
    state,
  });
  return `${endpoints.authorize}?${params}`;
}

function basicAuth(config: QboConfig): string {
  return "Basic " + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  x_refresh_token_expires_in?: number;
}

export function toTokenSet(body: TokenResponse, now: Date = new Date()): TokenSet {
  return {
    accessToken: body.access_token,
    // Treat the access token as expiring a minute early so it is never used at the edge.
    accessExpiresAt: new Date(now.getTime() + (body.expires_in - 60) * 1000),
    refreshToken: body.refresh_token,
    refreshExpiresAt: body.x_refresh_token_expires_in
      ? new Date(now.getTime() + body.x_refresh_token_expires_in * 1000)
      : null,
  };
}

async function tokenRequest(config: QboConfig, form: Record<string, string>): Promise<TokenSet> {
  const { token } = await getEndpoints(config);
  const res = await fetch(token, {
    method: "POST",
    headers: {
      Authorization: basicAuth(config),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form),
    cache: "no-store",
  });
  if (!res.ok) {
    // The body can name the reason (for example invalid_grant) but never holds a secret.
    const detail = (await res.text()).slice(0, 200);
    if (res.status === 400 && detail.includes("invalid_grant")) throw new QboReconnectError();
    throw new Error(`QuickBooks sign-in failed (${res.status}): ${detail}`);
  }
  return toTokenSet((await res.json()) as TokenResponse);
}

export function exchangeCode(config: QboConfig, code: string): Promise<TokenSet> {
  return tokenRequest(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });
}

/** Intuit may hand back a new refresh token each time; the caller must save the result. */
export function refreshTokens(config: QboConfig, refreshToken: string): Promise<TokenSet> {
  return tokenRequest(config, { grant_type: "refresh_token", refresh_token: refreshToken });
}

export async function revokeToken(config: QboConfig, refreshToken: string): Promise<void> {
  const { revoke } = await getEndpoints(config);
  await fetch(revoke, {
    method: "POST",
    headers: {
      Authorization: basicAuth(config),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token: refreshToken }),
    cache: "no-store",
  });
}
