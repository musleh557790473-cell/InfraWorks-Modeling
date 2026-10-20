import {
  APS_BASE,
  INTERNAL_SCOPES,
  VIEWER_SCOPES,
  type ApsConfig,
  type ApsToken,
} from "./types.js";

type ScopeList = readonly string[];

const cache = new Map<string, ApsToken>();

function cacheKey(clientId: string, scopes: ScopeList): string {
  return `${clientId}::${scopes.slice().sort().join(" ")}`;
}

export function isApsConfigured(config: ApsConfig): boolean {
  return Boolean(config.clientId && config.clientSecret);
}

export async function getTwoLeggedToken(
  config: ApsConfig,
  scopes: ScopeList = INTERNAL_SCOPES,
): Promise<ApsToken> {
  if (!isApsConfigured(config)) {
    return {
      access_token: "local-mock-token",
      token_type: "Bearer",
      expires_in: 3600,
      expires_at: Date.now() + 3600_000,
      mocked: true,
      scopes: [...scopes],
    };
  }

  const key = cacheKey(config.clientId!, scopes);
  const hit = cache.get(key);
  if (hit && hit.expires_at > Date.now() + 60_000) {
    return hit;
  }

  const base = config.baseUrl ?? APS_BASE;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId!,
    client_secret: config.clientSecret!,
    scope: scopes.join(" "),
  });

  const res = await fetch(`${base}/authentication/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`APS token failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
  };

  const token: ApsToken = {
    access_token: json.access_token,
    token_type: json.token_type || "Bearer",
    expires_in: json.expires_in,
    expires_at: Date.now() + json.expires_in * 1000,
    mocked: false,
    scopes: [...scopes],
  };
  cache.set(key, token);
  return token;
}

export async function getViewerToken(config: ApsConfig): Promise<ApsToken> {
  return getTwoLeggedToken(config, VIEWER_SCOPES);
}

export function clearTokenCache(): void {
  cache.clear();
}
