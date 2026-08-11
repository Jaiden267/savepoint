import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGetAccessToken, mockSchedule } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockSchedule: vi.fn(),
}));

vi.mock("./token", () => ({
  getAccessToken: mockGetAccessToken,
  IgdbAuthError: class IgdbAuthError extends Error {},
}));

vi.mock("./rate-limiter", () => ({
  igdbRateLimiter: { schedule: mockSchedule },
}));

import {
  igdbRequest,
  IgdbTimeoutError,
  IgdbRateLimitError,
  IgdbHttpError,
} from "./client";

const mockFetch = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  mockGetAccessToken.mockReset().mockResolvedValue("test-token");
  mockSchedule
    .mockReset()
    .mockImplementation((fn: () => Promise<Response>) => fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Unconditional, regardless of whether the fake-timers test below ran to
  // completion or its assertion threw first — leaking fake timers into a
  // later test is what caused an intermittent unhandled-rejection warning.
  vi.useRealTimers();
});

describe("igdbRequest", () => {
  it("sends Client-ID and Authorization headers, never logging the token", async () => {
    mockFetch.mockResolvedValue(jsonResponse([{ id: 1 }]));

    await igdbRequest("games", "fields id;");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["Client-ID"]).toBeTruthy();
  });

  it("returns the parsed JSON array on success", async () => {
    mockFetch.mockResolvedValue(jsonResponse([{ id: 1 }, { id: 2 }]));

    const result = await igdbRequest("games", "fields id;");

    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("retries once on a 429 and succeeds", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({}, false, 429))
      .mockResolvedValueOnce(jsonResponse([{ id: 1 }]));

    const result = await igdbRequest("games", "fields id;");

    expect(result).toEqual([{ id: 1 }]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("bounds retries at 3 total attempts, then throws IgdbHttpError on persistent 5xx", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, false, 503));

    await expect(igdbRequest("games", "fields id;")).rejects.toBeInstanceOf(
      IgdbHttpError,
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  }, 10_000);

  it("throws IgdbRateLimitError once retries are exhausted on persistent 429", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, false, 429));

    await expect(igdbRequest("games", "fields id;")).rejects.toBeInstanceOf(
      IgdbRateLimitError,
    );
  }, 10_000);

  it("never retries a 4xx other than 429", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, false, 400));

    await expect(igdbRequest("games", "fields id;")).rejects.toBeInstanceOf(
      IgdbHttpError,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws IgdbTimeoutError when the request is aborted", async () => {
    mockFetch.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    vi.useFakeTimers();
    const promise = igdbRequest("games", "fields id;");
    // Attach the rejection handler before advancing timers — advancing can
    // trigger the rejection synchronously within that call, and asserting
    // on `promise` only afterward leaves a brief unhandled-rejection window
    // that Node warns about even though it's eventually observed.
    const assertion = expect(promise).rejects.toBeInstanceOf(IgdbTimeoutError);
    await vi.advanceTimersByTimeAsync(9000);
    await assertion;
    vi.useRealTimers();
  });
});
