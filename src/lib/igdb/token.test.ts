import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getAccessToken,
  IgdbAuthError,
  _resetIgdbTokenCacheForTests,
} from "./token";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  _resetIgdbTokenCacheForTests();
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("getAccessToken", () => {
  it("fetches and caches a token", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ access_token: "token-1", expires_in: 3600 }),
    );

    const token = await getAccessToken();

    expect(token).toBe("token-1");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("reuses the cached token while well within its expiry window", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ access_token: "token-1", expires_in: 3600 }),
    );

    await getAccessToken();
    await getAccessToken();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("refetches once the cached token is within the expiry buffer", async () => {
    // expires_in exactly equals the 60s refresh buffer, so by the second
    // call (even microseconds later) the cached token is already
    // considered stale.
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ access_token: "token-1", expires_in: 60 }),
    );
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ access_token: "token-2", expires_in: 3600 }),
    );

    const first = await getAccessToken();
    const second = await getAccessToken();

    expect(first).toBe("token-1");
    expect(second).toBe("token-2");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent requests when there is no cached token", async () => {
    let resolveFetch!: (value: Response) => void;
    mockFetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const first = getAccessToken();
    const second = getAccessToken();
    resolveFetch(jsonResponse({ access_token: "token-1", expires_in: 3600 }));

    const [a, b] = await Promise.all([first, second]);

    expect(a).toBe("token-1");
    expect(b).toBe("token-1");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws IgdbAuthError without caching on a non-ok response", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, false, 401));

    await expect(getAccessToken()).rejects.toBeInstanceOf(IgdbAuthError);
  });

  it("throws IgdbAuthError on a malformed response body", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ nonsense: true }));

    await expect(getAccessToken()).rejects.toBeInstanceOf(IgdbAuthError);
  });

  it("never includes a successfully-issued token value in a later thrown error message", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ access_token: "super-secret-token", expires_in: 60 }),
    );
    mockFetch.mockResolvedValueOnce(jsonResponse({}, false, 401));

    await getAccessToken();

    let thrown: unknown;
    try {
      await getAccessToken();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(IgdbAuthError);
    expect(String(thrown)).not.toContain("super-secret-token");
  });
});
