import { describe, it, expect } from "vitest";
import { mapIgdbGameToRow, mapIgdbSearchResult } from "./mappers";
import { igdbImageUrl } from "./image-url";
import type { IgdbGameDetailRaw, IgdbGameSearchRaw } from "./types";

function makeCompany(name: string, developer: boolean, publisher: boolean) {
  return { company: { name }, developer, publisher };
}

describe("igdbImageUrl", () => {
  it("builds a CDN URL from an image id and size", () => {
    expect(igdbImageUrl("co1wyy", "cover_big")).toBe(
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co1wyy.jpg",
    );
  });
});

describe("mapIgdbGameToRow", () => {
  it("maps a full, realistic raw detail response", () => {
    const raw: IgdbGameDetailRaw = {
      id: 1022,
      name: "The Legend of Zelda: Breath of the Wild",
      slug: "the-legend-of-zelda-breath-of-the-wild",
      summary: "Summary text.",
      storyline: "Storyline text.",
      first_release_date: 1488499200, // 2017-03-03
      cover: { image_id: "co1wyy" },
      screenshots: [{ image_id: "ss1" }, { image_id: "ss2" }],
      artworks: [{ image_id: "art1" }],
      genres: [{ id: 12, name: "Role-playing", slug: "rpg" }],
      platforms: [{ id: 130, name: "Nintendo Switch", slug: "switch" }],
      game_modes: [{ id: 1, name: "Single player", slug: "single-player" }],
      themes: [{ id: 1, name: "Fantasy", slug: "fantasy" }],
      keywords: Array.from({ length: 15 }, (_, i) => ({
        id: i,
        name: `keyword-${i}`,
      })),
      involved_companies: [
        makeCompany("Nintendo EPD", true, false),
        makeCompany("Nintendo", false, true),
      ],
      rating: 96.5,
      rating_count: 4200,
      aggregated_rating: 97.1,
      aggregated_rating_count: 120,
      websites: [
        { url: "https://www.zelda.com/", type: { id: 1, type: "official" } },
        {
          url: "https://store.steampowered.com/x",
          type: { id: 2, type: "steam" },
        },
        {
          url: "https://www.reddit.com/r/zelda",
          type: { id: 3, type: "reddit" },
        },
        { url: "javascript:alert(1)", type: { id: 4, type: "official" } },
      ],
      game_type: { id: 0, type: "main_game" },
      version_parent: null,
    };

    const mapped = mapIgdbGameToRow(raw);

    expect(mapped.game.igdb_id).toBe(1022);
    expect(mapped.game.slug).toBe("the-legend-of-zelda-breath-of-the-wild");
    expect(mapped.game.cover_image_id).toBe("co1wyy");
    expect(mapped.game.release_date).toBe("2017-03-03");
    expect(mapped.game.igdb_game_type).toBe("main_game");
    expect(mapped.game.igdb_game_type_id).toBe(0);
    expect(mapped.game.version_parent_igdb_id).toBeNull();
    expect(mapped.game.igdb_rating).toBe(96.5);
    expect(mapped.game.igdb_aggregated_rating).toBe(97.1);

    // Keywords capped at 10 even though 15 were returned.
    expect(mapped.game.keywords).toHaveLength(10);

    // Developer/publisher correctly split by the involved_companies flags.
    expect(mapped.game.developer_names).toEqual(["Nintendo EPD"]);
    expect(mapped.game.publisher_names).toEqual(["Nintendo"]);

    // Website allow-list: reddit dropped (not allow-listed), javascript:
    // dropped (unsafe protocol), official + steam kept.
    expect(mapped.game.websites).toEqual([
      { type: "official", url: "https://www.zelda.com/" },
      { type: "steam", url: "https://store.steampowered.com/x" },
    ]);

    expect(mapped.genres).toEqual([
      { id: 12, name: "Role-playing", slug: "rpg" },
    ]);
    expect(mapped.platforms).toEqual([
      { id: 130, name: "Nintendo Switch", slug: "switch" },
    ]);
    expect(mapped.gameModes).toEqual([
      { id: 1, name: "Single player", slug: "single-player" },
    ]);
    expect(mapped.themes).toEqual([
      { id: 1, name: "Fantasy", slug: "fantasy" },
    ]);
  });

  it("caps websites at 8 entries", () => {
    const raw: IgdbGameDetailRaw = {
      id: 1,
      name: "Game",
      slug: "game",
      websites: Array.from({ length: 10 }, () => ({
        url: "https://store.steampowered.com/x",
        type: { id: 1, type: "steam" },
      })),
    };

    const mapped = mapIgdbGameToRow(raw);

    expect(mapped.game.websites).toHaveLength(8);
  });

  it("is null-safe for a minimal raw response with no nested fields", () => {
    const raw: IgdbGameDetailRaw = {
      id: 42,
      name: "Minimal Game",
      slug: "minimal-game",
    };

    const mapped = mapIgdbGameToRow(raw);

    expect(mapped.game.cover_image_id).toBeNull();
    expect(mapped.game.summary).toBeNull();
    expect(mapped.game.storyline).toBeNull();
    expect(mapped.game.release_date).toBeNull();
    expect(mapped.game.screenshot_image_ids).toEqual([]);
    expect(mapped.game.artwork_image_ids).toEqual([]);
    expect(mapped.game.keywords).toEqual([]);
    expect(mapped.game.developer_names).toEqual([]);
    expect(mapped.game.publisher_names).toEqual([]);
    expect(mapped.game.websites).toEqual([]);
    expect(mapped.game.igdb_game_type).toBeNull();
    expect(mapped.game.igdb_game_type_id).toBeNull();
    expect(mapped.game.version_parent_igdb_id).toBeNull();
    expect(mapped.genres).toEqual([]);
    expect(mapped.platforms).toEqual([]);
    expect(mapped.gameModes).toEqual([]);
    expect(mapped.themes).toEqual([]);
  });

  it("drops a website entry whose type never resolved (null)", () => {
    const raw: IgdbGameDetailRaw = {
      id: 1,
      name: "Game",
      slug: "game",
      websites: [{ url: "https://example.com" }],
    };

    expect(mapIgdbGameToRow(raw).game.websites).toEqual([]);
  });
});

describe("mapIgdbSearchResult", () => {
  it("maps a raw search row into the unified shape", () => {
    const raw: IgdbGameSearchRaw = {
      id: 7,
      name: "Halo Infinite",
      slug: "halo-infinite",
      cover: { image_id: "co123" },
      game_type: { id: 0, type: "main_game" },
      version_parent: null,
      first_release_date: 1637020800, // 2021-11-15
    };

    expect(mapIgdbSearchResult(raw)).toEqual({
      source: "igdb",
      igdbId: 7,
      slug: "halo-infinite",
      name: "Halo Infinite",
      coverImageId: "co123",
      releaseYear: 2021,
      gameType: "main_game",
      versionParentIgdbId: null,
    });
  });

  it("is null-safe for a minimal search row", () => {
    const raw: IgdbGameSearchRaw = { id: 1, name: "Game", slug: "game" };

    expect(mapIgdbSearchResult(raw)).toEqual({
      source: "igdb",
      igdbId: 1,
      slug: "game",
      name: "Game",
      coverImageId: null,
      releaseYear: null,
      gameType: null,
      versionParentIgdbId: null,
    });
  });
});
