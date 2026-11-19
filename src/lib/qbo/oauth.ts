// The sign-in handshake with Intuit (OAuth 2.0).

import { QBO_SCOPE, type QboConfig } from "./config";

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

export interface TokenSet {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date | null;
}

/** Where to send an admin's browser to approve the connection. */
export function authorizeUrl(config: QboConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: QBO_SCOPE,
    redirect_uri: config.redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
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
  const res = await fetch(TOKEN_URL, {
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
  await fetch(REVOKE_URL, {
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
