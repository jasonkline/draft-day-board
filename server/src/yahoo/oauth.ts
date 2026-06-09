// Yahoo OAuth 2.0 (authorization-code flow for a confidential server-side app).
//
// One-time: the developer authorizes in a browser, we exchange the `code` for a
// refresh token (saved to .env). Thereafter the refresh token mints short-lived
// access tokens on demand. See:
//   https://developer.yahoo.com/oauth2/guide/flows_authcode/

import { readYahooConfig, type YahooConfig } from "./env.js";

const AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
// Fantasy Sports read scope (matches the "Fantasy Sports → Read" app permission).
const SCOPE = "fspt-r";

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
  xoauth_yahoo_guid?: string;
}

/**
 * Build the consent URL the user opens in a browser to authorize the app.
 * `state` is the OAuth CSRF nonce — echo-verified when the redirect comes back.
 */
export function buildAuthUrl(cfg: YahooConfig, state?: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: SCOPE,
    language: "en-us",
  });
  if (state) params.set("state", state);
  return `${AUTH_URL}?${params.toString()}`;
}

function basicAuthHeader(cfg: YahooConfig): string {
  const raw = `${cfg.clientId}:${cfg.clientSecret}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

async function postToken(
  cfg: YahooConfig,
  body: Record<string, string>
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(cfg),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Yahoo token request failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as TokenResponse;
}

/** Exchange a one-time authorization code for access + refresh tokens. */
export function exchangeCodeForTokens(
  cfg: YahooConfig,
  code: string
): Promise<TokenResponse> {
  return postToken(cfg, {
    grant_type: "authorization_code",
    redirect_uri: cfg.redirectUri,
    code,
  });
}

/** Use the stored refresh token to mint a fresh access token. */
export function refreshAccessToken(
  cfg: YahooConfig,
  refreshToken: string
): Promise<TokenResponse> {
  return postToken(cfg, {
    grant_type: "refresh_token",
    redirect_uri: cfg.redirectUri,
    refresh_token: refreshToken,
  });
}

// In-memory access-token cache so a single sync run reuses one token.
let cached: { token: string; expiresAt: number } | null = null;

/**
 * Return a valid access token, refreshing if needed. Requires
 * YAHOO_REFRESH_TOKEN to be set (run `npm run yahoo:auth` first).
 */
export async function getAccessToken(): Promise<string> {
  const cfg = readYahooConfig();
  if (!cfg.refreshToken) {
    throw new Error(
      "YAHOO_REFRESH_TOKEN is not set. Run `npm run yahoo:auth` to authorize once."
    );
  }
  const now = Date.now();
  if (cached && cached.expiresAt - 60_000 > now) return cached.token;

  const tok = await refreshAccessToken(cfg, cfg.refreshToken);
  cached = {
    token: tok.access_token,
    expiresAt: now + tok.expires_in * 1000,
  };
  return tok.access_token;
}
