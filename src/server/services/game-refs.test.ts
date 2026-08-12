import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getGameTaggedRefs } from "./game-refs";

/**
 * Minimal duck-typed stub covering only the `.from().select().eq()`/
 * `.from().select().in()` shapes fetchTaggedRefs actually calls — cast at
 * the boundary since implementing the full real SupabaseClient interface
 * isn't practical for a unit test. Confined to this test file only.
 */
function makeSupabase(dataByTable: Record<string, unknown[]>) {
  const from = vi.fn((table: string) => {
    const rows = dataByTable[table] ?? [];
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => Promise.resolve({ data: rows })),
      in: vi.fn(() => Promise.resolve({ data: rows })),
    };
    return chain;
  });
  return { from } as unknown as SupabaseClient<Database>;
}

describe("getGameTaggedRefs", () => {
  it("resolves all four tagged relations via a two-step join-then-reference fetch, matching the prior inline page.tsx behavior", async () => {
    const supabase = makeSupabase({
      game_genres: [{ game_id: "g1", genre_id: 1 }],
      genres: [{ id: 1, name: "Action", slug: "action" }],
      game_platforms: [{ game_id: "g1", platform_id: 2 }],
      platforms: [{ id: 2, name: "Switch", slug: "switch" }],
      game_game_modes: [{ game_id: "g1", game_mode_id: 3 }],
      game_modes: [{ id: 3, name: "Single player", slug: "single-player" }],
      game_themes: [{ game_id: "g1", theme_id: 4 }],
      themes: [{ id: 4, name: "Fantasy", slug: "fantasy" }],
    });

    const result = await getGameTaggedRefs(supabase, "g1");

    expect(result).toEqual({
      genres: [{ id: 1, name: "Action", slug: "action" }],
      platforms: [{ id: 2, name: "Switch", slug: "switch" }],
      gameModes: [{ id: 3, name: "Single player", slug: "single-player" }],
      themes: [{ id: 4, name: "Fantasy", slug: "fantasy" }],
    });
  });

  it("returns empty arrays for relations with no linked join rows", async () => {
    const supabase = makeSupabase({});

    const result = await getGameTaggedRefs(supabase, "g1");

    expect(result).toEqual({
      genres: [],
      platforms: [],
      gameModes: [],
      themes: [],
    });
  });
});
