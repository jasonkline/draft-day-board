// Thin authed JSON client for the Yahoo Fantasy Sports API.
// All requests go to fantasysports.yahooapis.com and ask for JSON.

import { getAccessToken } from "./oauth.js";

const API_BASE = "https://fantasysports.yahooapis.com/fantasy/v2";

/**
 * GET a Yahoo Fantasy resource path (e.g. `game/nfl/players;start=0;count=25`)
 * and return parsed JSON. Adds `?format=json` and a Bearer token. Retries once
 * on 401 with a freshly minted token.
 */
export async function yahooGet(path: string): Promise<any> {
  const url = `${API_BASE}/${path}${path.includes("?") ? "&" : "?"}format=json`;

  const attempt = async (token: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  let token = await getAccessToken();
  let res = await attempt(token);

  if (res.status === 401) {
    // Token may have just expired; force a refresh and retry once.
    token = await getAccessToken();
    res = await attempt(token);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Yahoo API ${res.status} for ${path}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}
