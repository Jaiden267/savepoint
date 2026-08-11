import "server-only";
import { serverEnv } from "@/lib/env.server";

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";

/** Refresh this long before actual expiry, so a cached token is never used right at the edge of expiring mid-request. */
const EXPIRY_BUFFER_MS = 60_000;

export class IgdbAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IgdbAuthError";
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;
let inFlight: Promise<string> | null = null;

async function requestNewToken(): Promise<string> {
  const params = new URLSearchParams({
    client_id: serverEnv.IGDB_CLIENT_ID,
    client_secret: serverEnv.IGDB_CLIENT_SECRET,
    grant_type: "client_credentials",
  });

  let response: Response;
  try {
    response = await fetch(`${TWITCH_TOKEN_URL}?${params.toString()}`, {
      method: "POST",
    });
  } catch {
    // Never include the underlying error — it could echo request details.
    throw new IgdbAuthError("Failed to reach the Twitch token endpoint.");
  }

  if (!response.ok) {
    throw new IgdbAuthError(
      `Twitch token request failed with status ${response.status}.`,
    );
  }

  const data = (await response.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
  } | null;

  if (!data?.access_token || typeof data.expires_in !== "number") {
    throw new IgdbAuthError("Twitch token response was malformed.");
  }

  cached = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cached.token;
}

/**
 * Returns a valid Twitch app access token for IGDB requests, cached in
 * memory until shortly before expiry. Concurrent callers with no valid
 * cached token share one in-flight request rather than each firing their
 * own. The token value itself is never logged, thrown in an error message,
 * or persisted anywhere.
 */
export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt - EXPIRY_BUFFER_MS > Date.now()) {
    return cached.token;
  }

  if (!inFlight) {
    inFlight = requestNewToken().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Test-only: clears the cached token and any in-flight request so tests don't leak state into each other. */
export function _resetIgdbTokenCacheForTests() {
  cached = null;
  inFlight = null;
}
