import "server-only";
import { igdbRequest } from "./client";
import { buildDetailBySlugQuery, buildDetailQuery } from "./apicalypse";
import { mapIgdbGameToRow } from "./mappers";
import type { IgdbGameDetail, IgdbGameDetailRaw } from "./types";

/**
 * Fetches and maps a single game's full detail by IGDB id — exactly one
 * IGDB request. Returns null if IGDB has no such game (never throws for a
 * simple not-found).
 */
export async function fetchIgdbGameByIgdbId(
  igdbId: number,
): Promise<IgdbGameDetail | null> {
  const raw = await igdbRequest<IgdbGameDetailRaw>(
    "games",
    buildDetailQuery(igdbId),
  );
  const first = raw[0];
  if (!first) return null;
  return mapIgdbGameToRow(first);
}

/**
 * Fetches and maps a single game's full detail by IGDB slug — exactly one
 * IGDB request, returning the complete normalized detail directly so a
 * cold-slug import never needs a second detail fetch to resolve an id
 * first (see game-sync.ts's importGameBySlug). Returns null if IGDB has no
 * such slug.
 */
export async function fetchIgdbGameBySlug(
  slug: string,
): Promise<IgdbGameDetail | null> {
  const raw = await igdbRequest<IgdbGameDetailRaw>(
    "games",
    buildDetailBySlugQuery(slug),
  );
  const first = raw[0];
  if (!first) return null;
  return mapIgdbGameToRow(first);
}
