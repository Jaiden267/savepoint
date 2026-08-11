import "server-only";
import { serverEnv } from "@/lib/env.server";
import { getAccessToken, IgdbAuthError } from "./token";
import { igdbRateLimiter } from "./rate-limiter";

const IGDB_BASE_URL = "https://api.igdb.com/v4";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;

export { IgdbAuthError };

export class IgdbTimeoutError extends Error {
  constructor(endpoint: string) {
    super(`IGDB request to "${endpoint}" timed out.`);
    this.name = "IgdbTimeoutError";
  }
}

export class IgdbRateLimitError extends Error {
  constructor(endpoint: string) {
    super(`IGDB rate-limited the request to "${endpoint}".`);
    this.name = "IgdbRateLimitError";
  }
}

export class IgdbHttpError extends Error {
  readonly status: number;
  constructor(endpoint: string, status: number) {
    super(`IGDB request to "${endpoint}" failed with status ${status}.`);
    this.name = "IgdbHttpError";
    this.status = status;
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function performRequest<T>(
  endpoint: string,
  apicalypseBody: string,
  attempt: number,
): Promise<T[]> {
  const token = await getAccessToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await igdbRateLimiter.schedule(() =>
      fetch(`${IGDB_BASE_URL}/${endpoint}`, {
        method: "POST",
        headers: {
          "Client-ID": serverEnv.IGDB_CLIENT_ID,
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain",
        },
        body: apicalypseBody,
        signal: controller.signal,
      }),
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new IgdbTimeoutError(endpoint);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    if (isRetryableStatus(response.status) && attempt < MAX_ATTEMPTS) {
      const backoffMs = 2 ** (attempt - 1) * 250 + Math.random() * 100;
      await sleep(backoffMs);
      return performRequest<T>(endpoint, apicalypseBody, attempt + 1);
    }
    if (response.status === 429) {
      throw new IgdbRateLimitError(endpoint);
    }
    throw new IgdbHttpError(endpoint, response.status);
  }

  return (await response.json()) as T[];
}

/**
 * Issues an Apicalypse query against IGDB — rate-limited (rate-limiter.ts),
 * timed out (~8s), and bounded-retried (max 3 attempts total, only on
 * 429/5xx, never 4xx). `apicalypseBody` must come from apicalypse.ts —
 * nothing else in the app builds one, so no arbitrary Apicalypse body is
 * ever reachable from user input.
 */
export async function igdbRequest<T>(
  endpoint: string,
  apicalypseBody: string,
): Promise<T[]> {
  return performRequest<T>(endpoint, apicalypseBody, 1);
}
