import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database.ts";
import {
  CATALOGUE_LEASE_MS,
  CATALOGUE_LEASE_HEARTBEAT_MS,
} from "./constants.ts";

/**
 * Deliberately NOT `server-only`: its one and only caller,
 * scripts/igdb-catalogue-sync.mts, is a plain Node script outside Next's
 * bundler (see apicalypse.ts's header comment for why that matters). No
 * app-runtime request path ever acquires the catalogue lease — only the
 * operator-run catalogue sync commands do.
 *
 * The single durable, fenced, heartbeat-renewed lease shared by every
 * mutating catalogue command (discover/sync/incremental/release-check) —
 * they can never run concurrently with each other or with themselves.
 * Backed by the singleton `igdb_catalogue_lease` row (migration
 * 20260813120000), never a local PID file, so it works unchanged after
 * Docker/ZimaOS deployment and is visible/inspectable from anywhere.
 *
 * The fencing guarantee this provides is honest, not oversold: a lost
 * lease is detected at most one heartbeat interval late, so a stale
 * worker could in principle perform up to one batch's worth of writes
 * after actually losing the lease before its next heartbeat check catches
 * it. Neither Pinecone nor Supabase's normal write APIs accept a
 * caller-supplied fencing token, so true zero-gap fencing isn't
 * achievable here without far more machinery than this system needs —
 * callers must still check `isHeld()` before every batch's mutating
 * calls, not just rely on the heartbeat interval alone.
 */

export type CatalogueCommand =
  "discover" | "sync" | "incremental" | "release-check";

export class CatalogueLeaseNotAcquiredError extends Error {
  constructor(message = "Another catalogue command is currently running.") {
    super(message);
    this.name = "CatalogueLeaseNotAcquiredError";
  }
}

export class CatalogueLease {
  private token: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lost = false;
  // Not a TS parameter-property — Node's native strip-only TypeScript mode
  // (used to run scripts/igdb-catalogue-sync.mts, this module's only
  // caller, directly) doesn't support that syntax.
  private readonly supabase: SupabaseClient<Database>;

  private constructor(supabase: SupabaseClient<Database>, token: string) {
    this.supabase = supabase;
    this.token = token;
  }

  /** Attempts to acquire the global lease. Throws CatalogueLeaseNotAcquiredError if another live lease already holds it. */
  static async acquire(
    supabase: SupabaseClient<Database>,
    command: CatalogueCommand,
    holder: string,
  ): Promise<CatalogueLease> {
    const token = crypto.randomUUID();
    const now = new Date();
    const leaseUntil = new Date(
      now.getTime() + CATALOGUE_LEASE_MS,
    ).toISOString();

    const { data, error } = await supabase
      .from("igdb_catalogue_lease")
      .update({
        token,
        holder,
        command,
        acquired_at: now.toISOString(),
        lease_until: leaseUntil,
      })
      .eq("id", true)
      .or(`token.is.null,lease_until.lt.${now.toISOString()}`)
      .select("id");

    if (error) {
      throw new Error(`Failed to acquire catalogue lease: ${error.message}`);
    }
    if (!data || data.length === 0) {
      throw new CatalogueLeaseNotAcquiredError();
    }

    const lease = new CatalogueLease(supabase, token);
    lease.startHeartbeat();
    return lease;
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.renew();
    }, CATALOGUE_LEASE_HEARTBEAT_MS);
    // Never keep the process alive solely for the heartbeat timer.
    this.heartbeatTimer.unref?.();
  }

  private async renew(): Promise<void> {
    if (!this.token || this.lost) return;
    const leaseUntil = new Date(Date.now() + CATALOGUE_LEASE_MS).toISOString();
    const { data, error } = await this.supabase
      .from("igdb_catalogue_lease")
      .update({ lease_until: leaseUntil })
      .eq("id", true)
      .eq("token", this.token)
      .select("id");

    if (error || !data || data.length === 0) {
      this.lost = true;
    }
  }

  /** Must be checked before every batch's mutating Pinecone/Supabase calls — if the lease was lost, the caller must stop before performing that batch's writes. */
  isHeld(): boolean {
    return this.token !== null && !this.lost;
  }

  /** The current fencing token, required by advance_catalogue_discovery's p_lease_token argument. Throws if the lease has been lost. */
  requireToken(): string {
    if (!this.isHeld() || !this.token) {
      throw new CatalogueLeaseNotAcquiredError(
        "Catalogue lease was lost mid-run.",
      );
    }
    return this.token;
  }

  /** Releases the lease back to its pristine unheld state, conditional on still holding the token — never clobbers a lease legitimately reclaimed by someone else. */
  async release(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (!this.token) return;
    await this.supabase
      .from("igdb_catalogue_lease")
      .update({
        token: null,
        holder: null,
        command: null,
        acquired_at: null,
        lease_until: null,
      })
      .eq("id", true)
      .eq("token", this.token);
    this.token = null;
  }
}
