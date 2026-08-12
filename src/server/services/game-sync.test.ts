import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetRateLimitsForTests } from "@/lib/rate-limit";
import type { IgdbGameDetail } from "@/lib/igdb/types";
import type { Tables } from "@/types/database";

const { mockFetchByIgdbId, mockFetchBySlug, mockAdminFrom, mockServerFrom } =
  vi.hoisted(() => ({
    mockFetchByIgdbId: vi.fn(),
    mockFetchBySlug: vi.fn(),
    mockAdminFrom: vi.fn(),
    mockServerFrom: vi.fn(),
  }));

vi.mock("@/lib/igdb/detail", () => ({
  fetchIgdbGameByIgdbId: mockFetchByIgdbId,
  fetchIgdbGameBySlug: mockFetchBySlug,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ from: mockServerFrom }),
}));

import {
  upsertGameFromIgdbDetail,
  importGameByIgdbId,
  findCachedGameBySlug,
  getOrImportGameBySlug,
  GameImportRateLimitedError,
} from "./game-sync";

type GameRow = Tables<"games">;

const IMPORTED_GAME: GameRow = {
  id: "uuid-1",
  igdb_id: 1022,
  name: "Breath of the Wild",
  slug: "breath-of-the-wild",
  summary: null,
  storyline: null,
  release_date: null,
  cover_image_id: null,
  screenshot_image_ids: [],
  artwork_image_ids: [],
  igdb_rating: null,
  igdb_rating_count: null,
  igdb_aggregated_rating: null,
  igdb_aggregated_rating_count: null,
  igdb_synced_at: new Date().toISOString(),
  igdb_game_type_id: 0,
  igdb_game_type: "main_game",
  version_parent_igdb_id: null,
  keywords: [],
  developer_names: [],
  publisher_names: [],
  websites: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const SAMPLE_DETAIL: IgdbGameDetail = {
  game: {
    igdb_id: 1022,
    name: "Breath of the Wild",
    slug: "breath-of-the-wild",
    summary: null,
    storyline: null,
    release_date: null,
    cover_image_id: null,
    screenshot_image_ids: [],
    artwork_image_ids: [],
    igdb_rating: null,
    igdb_rating_count: null,
    igdb_aggregated_rating: null,
    igdb_aggregated_rating_count: null,
    igdb_synced_at: new Date().toISOString(),
    igdb_game_type_id: 0,
    igdb_game_type: "main_game",
    version_parent_igdb_id: null,
    keywords: [],
    developer_names: [],
    publisher_names: [],
    websites: [],
  },
  genres: [{ id: 12, name: "Adventure", slug: "adventure" }],
  platforms: [{ id: 130, name: "Switch", slug: "switch" }],
  gameModes: [{ id: 1, name: "Single player", slug: "single-player" }],
  themes: [{ id: 1, name: "Fantasy", slug: "fantasy" }],
};

/** Every chain method resolves to (or returns something that resolves to) `result`, whichever point in the chain game-sync.ts happens to await. */
function createTableMock(result: { data?: unknown; error?: unknown }) {
  const resolved = { data: null, error: null, ...result };
  const chain: Record<string, unknown> = {
    upsert: vi.fn(() => chain),
    insert: vi.fn(() => Promise.resolve(resolved)),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => Promise.resolve(resolved)),
    select: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(resolved)),
    then: (
      resolve: (v: typeof resolved) => void,
      reject?: (e: unknown) => void,
    ) => Promise.resolve(resolved).then(resolve, reject),
  };
  return chain;
}

function setupAdminMock(
  overrides: Record<string, { data?: unknown; error?: unknown }> = {},
) {
  const defaults: Record<string, { data?: unknown; error?: unknown }> = {
    genres: {},
    platforms: {},
    game_modes: {},
    themes: {},
    games: { data: IMPORTED_GAME },
    game_genres: {},
    game_platforms: {},
    game_game_modes: {},
    game_themes: {},
    game_vector_sync: {},
  };
  const merged = { ...defaults, ...overrides };
  const tableMocks: Record<string, ReturnType<typeof createTableMock>> = {};
  for (const [table, result] of Object.entries(merged)) {
    tableMocks[table] = createTableMock(result);
  }
  mockAdminFrom.mockImplementation(
    (table: string) => tableMocks[table] ?? createTableMock({}),
  );
  return tableMocks;
}

function setupServerGamesMock(existing: GameRow | null) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve({ data: existing, error: null })),
  };
  mockServerFrom.mockImplementation(() => chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitsForTests();
  mockFetchByIgdbId.mockResolvedValue(SAMPLE_DETAIL);
  mockFetchBySlug.mockResolvedValue(SAMPLE_DETAIL);
});

describe("upsertGameFromIgdbDetail", () => {
  it("upserts reference rows, the game row, replaces join rows, and marks the game for vector sync", async () => {
    const tableMocks = setupAdminMock();

    const result = await upsertGameFromIgdbDetail(SAMPLE_DETAIL);

    expect(result).toEqual(IMPORTED_GAME);
    expect(tableMocks.genres.upsert).toHaveBeenCalledWith(
      SAMPLE_DETAIL.genres,
      {
        onConflict: "id",
      },
    );
    expect(tableMocks.platforms.upsert).toHaveBeenCalledWith(
      SAMPLE_DETAIL.platforms,
      { onConflict: "id" },
    );
    expect(tableMocks.games.upsert).toHaveBeenCalledWith(SAMPLE_DETAIL.game, {
      onConflict: "igdb_id",
    });
    expect(tableMocks.game_genres.delete).toHaveBeenCalled();
    expect(tableMocks.game_genres.eq).toHaveBeenCalledWith(
      "game_id",
      IMPORTED_GAME.id,
    );
    expect(tableMocks.game_genres.insert).toHaveBeenCalledWith([
      { game_id: IMPORTED_GAME.id, genre_id: 12 },
    ]);
    expect(tableMocks.game_vector_sync.upsert).toHaveBeenCalledWith(
      {
        game_id: IMPORTED_GAME.id,
        status: "pending",
        last_attempted_at: null,
      },
      { onConflict: "game_id" },
    );
  });

  it("resets last_attempted_at to null so a freshly (re)imported game is immediately claimable, never looking like it's still under an active sync lease", async () => {
    const tableMocks = setupAdminMock();

    await upsertGameFromIgdbDetail(SAMPLE_DETAIL);

    const [payload] = (
      tableMocks.game_vector_sync.upsert as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [Record<string, unknown>, unknown];
    expect(payload.last_attempted_at).toBeNull();
    // attempt_count/error/last_synced_at are deliberately absent from the
    // payload — left untouched on conflict, preserved as historical record.
    expect(payload).not.toHaveProperty("attempt_count");
    expect(payload).not.toHaveProperty("error");
    expect(payload).not.toHaveProperty("last_synced_at");
  });

  it("running the same upsert twice still targets games by onConflict: igdb_id both times — the mechanism that structurally prevents a duplicate row (end-to-end row-uniqueness is additionally verified by the live smoke test)", async () => {
    const tableMocks = setupAdminMock();

    await upsertGameFromIgdbDetail(SAMPLE_DETAIL);
    await upsertGameFromIgdbDetail(SAMPLE_DETAIL);

    expect(tableMocks.games.upsert).toHaveBeenCalledTimes(2);
    for (const call of (tableMocks.games.upsert as ReturnType<typeof vi.fn>)
      .mock.calls) {
      expect(call[1]).toEqual({ onConflict: "igdb_id" });
    }
  });
});

describe("importGameByIgdbId", () => {
  it("short-circuits with no IGDB call when the cached row is fresh", async () => {
    setupServerGamesMock(IMPORTED_GAME);

    const result = await importGameByIgdbId(1022);

    expect(result).toEqual(IMPORTED_GAME);
    expect(mockFetchByIgdbId).not.toHaveBeenCalled();
  });

  it("re-fetches and upserts when the cached row is stale", async () => {
    setupServerGamesMock({
      ...IMPORTED_GAME,
      igdb_synced_at: new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });
    setupAdminMock();

    await importGameByIgdbId(1022);

    expect(mockFetchByIgdbId).toHaveBeenCalledWith(1022);
  });
});

describe("findCachedGameBySlug", () => {
  it("is a local-only lookup that never touches IGDB", async () => {
    setupServerGamesMock(IMPORTED_GAME);

    const result = await findCachedGameBySlug("breath-of-the-wild");

    expect(result).toEqual(IMPORTED_GAME);
    expect(mockFetchByIgdbId).not.toHaveBeenCalled();
    expect(mockFetchBySlug).not.toHaveBeenCalled();
  });
});

describe("getOrImportGameBySlug", () => {
  it("on a cold miss, fetches by slug exactly once and never calls fetchIgdbGameByIgdbId (the single-detail-fetch fix)", async () => {
    setupServerGamesMock(null);
    setupAdminMock();

    await getOrImportGameBySlug("breath-of-the-wild", "client-1");

    expect(mockFetchBySlug).toHaveBeenCalledTimes(1);
    expect(mockFetchByIgdbId).not.toHaveBeenCalled();
  });

  it("throws GameImportRateLimitedError once the per-client import limit is exhausted with nothing cached", async () => {
    setupServerGamesMock(null);
    setupAdminMock();

    for (let i = 0; i < 8; i += 1) {
      await getOrImportGameBySlug("breath-of-the-wild", "client-2");
    }

    await expect(
      getOrImportGameBySlug("breath-of-the-wild", "client-2"),
    ).rejects.toBeInstanceOf(GameImportRateLimitedError);
  });

  it("serves a stale cached row instead of failing once the per-client import limit is exhausted", async () => {
    const stale = {
      ...IMPORTED_GAME,
      igdb_synced_at: new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    };
    setupServerGamesMock(stale);
    setupAdminMock();

    for (let i = 0; i < 8; i += 1) {
      await getOrImportGameBySlug("breath-of-the-wild", "client-3");
    }

    const result = await getOrImportGameBySlug(
      "breath-of-the-wild",
      "client-3",
    );
    expect(result).toEqual(stale);
  });

  it("never consumes a rate-limit slot on a fresh cache hit — many repeated fresh hits never throw", async () => {
    setupServerGamesMock(IMPORTED_GAME);

    for (let i = 0; i < 20; i += 1) {
      await expect(
        getOrImportGameBySlug("breath-of-the-wild", "client-4"),
      ).resolves.toEqual(IMPORTED_GAME);
    }
    expect(mockFetchBySlug).not.toHaveBeenCalled();
    expect(mockFetchByIgdbId).not.toHaveBeenCalled();
  });
});
