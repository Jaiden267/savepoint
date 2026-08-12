import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CatalogueLease, CatalogueLeaseNotAcquiredError } from "./lease";
import { CATALOGUE_LEASE_HEARTBEAT_MS } from "./constants";

function makeSupabaseStub() {
  const updateCalls: { table: string; payload: unknown }[] = [];
  // Controls what the next `.select("id")` resolves to — the acquire/renew/
  // release "did this actually affect a row" signal.
  let nextResult: { data: { id: boolean }[] | null } = { data: [{ id: true }] };

  function setNextResult(result: { data: { id: boolean }[] | null }) {
    nextResult = result;
  }

  const chain = {
    eq: vi.fn(() => chain),
    or: vi.fn(() => chain),
    select: vi.fn(() => Promise.resolve({ ...nextResult, error: null })),
  };

  const from = vi.fn((table: string) => ({
    update: vi.fn((payload: unknown) => {
      updateCalls.push({ table, payload });
      return chain;
    }),
  }));

  return { from, updateCalls, setNextResult, chain };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("CatalogueLease.acquire", () => {
  it("acquires when the lease row is free (token null or lease_until in the past) and returns a usable token", async () => {
    const { from } = makeSupabaseStub();
    const supabase = { from } as unknown as Parameters<
      typeof CatalogueLease.acquire
    >[0];

    const lease = await CatalogueLease.acquire(supabase, "discover", "host:1");

    expect(lease.isHeld()).toBe(true);
    expect(typeof lease.requireToken()).toBe("string");
    await lease.release();
  });

  it("rejects (CatalogueLeaseNotAcquiredError) when another live lease already holds it", async () => {
    const { from, setNextResult } = makeSupabaseStub();
    setNextResult({ data: [] }); // conditional update affected zero rows
    const supabase = { from } as unknown as Parameters<
      typeof CatalogueLease.acquire
    >[0];

    await expect(
      CatalogueLease.acquire(supabase, "sync", "host:1"),
    ).rejects.toBeInstanceOf(CatalogueLeaseNotAcquiredError);
  });

  it("succeeds again once a previously-held lease has expired — expired-lock recovery", async () => {
    // The stub can't model real SQL `lease_until < now()` filtering, but it
    // proves the acquire call is built with an `.or(...)` clause covering
    // both "unheld" and "expired" — the actual expiry evaluation happens
    // server-side in Postgres, exercised live in
    // scripts/catalogue-checkpoint-smoke-test.mts.
    const { from, chain } = makeSupabaseStub();
    const supabase = { from } as unknown as Parameters<
      typeof CatalogueLease.acquire
    >[0];

    await CatalogueLease.acquire(supabase, "incremental", "host:1");

    expect(chain.or).toHaveBeenCalledWith(
      expect.stringContaining("token.is.null"),
    );
    expect(chain.or).toHaveBeenCalledWith(
      expect.stringContaining("lease_until.lt."),
    );
  });
});

describe("CatalogueLease heartbeat renewal", () => {
  it("renews the lease_until on each heartbeat tick while held", async () => {
    const { from, updateCalls } = makeSupabaseStub();
    const supabase = { from } as unknown as Parameters<
      typeof CatalogueLease.acquire
    >[0];

    const lease = await CatalogueLease.acquire(supabase, "discover", "host:1");
    const updatesAfterAcquire = updateCalls.length;

    await vi.advanceTimersByTimeAsync(CATALOGUE_LEASE_HEARTBEAT_MS);

    expect(updateCalls.length).toBeGreaterThan(updatesAfterAcquire);
    expect(lease.isHeld()).toBe(true);
    await lease.release();
  });

  it("marks the lease lost (isHeld() false) once a heartbeat finds the token no longer matches — stale-worker rejection", async () => {
    const { from, setNextResult } = makeSupabaseStub();
    const supabase = { from } as unknown as Parameters<
      typeof CatalogueLease.acquire
    >[0];

    const lease = await CatalogueLease.acquire(supabase, "discover", "host:1");
    expect(lease.isHeld()).toBe(true);

    // Simulate the lease having been reclaimed by another worker: the next
    // conditional renewal update affects zero rows.
    setNextResult({ data: [] });
    await vi.advanceTimersByTimeAsync(CATALOGUE_LEASE_HEARTBEAT_MS);

    expect(lease.isHeld()).toBe(false);
    expect(() => lease.requireToken()).toThrow(CatalogueLeaseNotAcquiredError);
  });
});

describe("CatalogueLease.release", () => {
  it("releases conditionally on the held token, so a lost lease can't clobber whoever holds it now", async () => {
    const { from, chain } = makeSupabaseStub();
    const supabase = { from } as unknown as Parameters<
      typeof CatalogueLease.acquire
    >[0];

    const lease = await CatalogueLease.acquire(supabase, "discover", "host:1");
    await lease.release();

    expect(chain.eq).toHaveBeenCalledWith("id", true);
    expect(chain.eq).toHaveBeenCalledWith("token", expect.any(String));
  });

  it("stops the heartbeat timer on release", async () => {
    const { from, updateCalls } = makeSupabaseStub();
    const supabase = { from } as unknown as Parameters<
      typeof CatalogueLease.acquire
    >[0];

    const lease = await CatalogueLease.acquire(supabase, "discover", "host:1");
    await lease.release();
    const updatesAfterRelease = updateCalls.length;

    await vi.advanceTimersByTimeAsync(CATALOGUE_LEASE_HEARTBEAT_MS * 2);

    expect(updateCalls.length).toBe(updatesAfterRelease);
  });
});
