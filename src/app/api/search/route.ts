import { NextResponse, type NextRequest } from "next/server";
import { searchGames } from "@/server/services/game-catalogue";
import { searchQuerySchema } from "@/lib/validation/games";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIdentifier } from "@/lib/auth/request-ip";

export const dynamic = "force-dynamic";

const RESULT_LIMIT = 20;

/**
 * The only IGDB-touching HTTP endpoint exposed to the browser — consumed by
 * the search command dialog only (the /search page calls the service
 * directly, server-side). Not a generic IGDB proxy: the query is validated
 * and capped, results are capped, and this only ever calls
 * game-catalogue.searchGames — a read/merge operation that cannot import or
 * write anything.
 */
export async function GET(request: NextRequest) {
  const identifier = await getClientIdentifier();
  const rate = checkRateLimit(`search:${identifier}`, {
    limit: 20,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { results: [], reason: "rate_limited" },
      { status: 429 },
    );
  }

  const raw = request.nextUrl.searchParams.get("q") ?? "";
  const parsed = searchQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ results: [] });
  }

  const results = await searchGames(parsed.data, { limit: RESULT_LIMIT });
  return NextResponse.json({ results });
}
