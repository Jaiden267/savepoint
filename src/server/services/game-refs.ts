import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export interface NamedRef {
  id: number;
  name: string;
  slug: string;
}

export interface GameTaggedRefs {
  genres: NamedRef[];
  platforms: NamedRef[];
  gameModes: NamedRef[];
  themes: NamedRef[];
}

/**
 * Resolves a game's tagged reference rows (genres/platforms/modes/themes)
 * via the join table, in two safe steps rather than relying on nested-embed
 * type inference against the hand-patched types.ts. Extracted from
 * `src/app/games/[slug]/page.tsx` once `src/lib/pinecone/sync.ts` became a
 * second real call site. Accepts either the request-scoped session client
 * or the admin client — both resolve to `SupabaseClient<Database>`.
 */
async function fetchTaggedRefs(
  supabase: SupabaseClient<Database>,
  joinTable:
    "game_genres" | "game_platforms" | "game_game_modes" | "game_themes",
  joinColumn: "genre_id" | "platform_id" | "game_mode_id" | "theme_id",
  refTable: "genres" | "platforms" | "game_modes" | "themes",
  gameId: string,
): Promise<NamedRef[]> {
  const { data: links } = await supabase
    .from(joinTable)
    .select("*")
    .eq("game_id", gameId);

  const ids = (links ?? [])
    .map((link) => (link as unknown as Record<string, number>)[joinColumn])
    .filter((id): id is number => typeof id === "number");
  if (ids.length === 0) return [];

  const { data: refs } = await supabase
    .from(refTable)
    .select("id, name, slug")
    .in("id", ids);
  return refs ?? [];
}

export async function getGameTaggedRefs(
  supabase: SupabaseClient<Database>,
  gameId: string,
): Promise<GameTaggedRefs> {
  const [genres, platforms, gameModes, themes] = await Promise.all([
    fetchTaggedRefs(supabase, "game_genres", "genre_id", "genres", gameId),
    fetchTaggedRefs(
      supabase,
      "game_platforms",
      "platform_id",
      "platforms",
      gameId,
    ),
    fetchTaggedRefs(
      supabase,
      "game_game_modes",
      "game_mode_id",
      "game_modes",
      gameId,
    ),
    fetchTaggedRefs(supabase, "game_themes", "theme_id", "themes", gameId),
  ]);
  return { genres, platforms, gameModes, themes };
}
