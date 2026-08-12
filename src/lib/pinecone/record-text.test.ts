import { describe, it, expect } from "vitest";
import { buildGameEmbeddingText, buildGameRecordFields } from "./record-text";
import { PINECONE_SCHEMA_VERSION } from "./constants";

describe("buildGameEmbeddingText", () => {
  it("composes name, summary, and every tagged reference list", () => {
    const text = buildGameEmbeddingText({
      name: "Test Game",
      summary: "A test summary.",
      storyline: null,
      keywords: ["open world", "roguelike"],
      genres: [{ name: "Adventure" }],
      platforms: [{ name: "Switch" }],
      gameModes: [{ name: "Single player" }],
      themes: [{ name: "Fantasy" }],
    });
    expect(text).toContain("Test Game");
    expect(text).toContain("A test summary.");
    expect(text).toContain("Genres: Adventure.");
    expect(text).toContain("Platforms: Switch.");
    expect(text).toContain("Modes: Single player.");
    expect(text).toContain("Themes: Fantasy.");
    expect(text).toContain("Keywords: open world, roguelike.");
  });

  it("omits empty relations without leaving stray labels", () => {
    const text = buildGameEmbeddingText({
      name: "Bare Game",
      summary: null,
      storyline: null,
      keywords: [],
      genres: [],
      platforms: [],
      gameModes: [],
      themes: [],
    });
    expect(text).toBe("Bare Game");
  });

  it("falls back to storyline when summary is absent", () => {
    const text = buildGameEmbeddingText({
      name: "Story Game",
      summary: null,
      storyline: "A tale of two cities.",
      keywords: [],
      genres: [],
      platforms: [],
      gameModes: [],
      themes: [],
    });
    expect(text).toContain("A tale of two cities.");
  });

  it("truncates at a word boundary within the character budget, never mid-word", () => {
    // "alphabet " is 9 chars — guaranteed not to evenly divide a 6000-char
    // slice, so a naive character-count truncation would cut mid-word here.
    const longSummary = "alphabet ".repeat(2000);
    const text = buildGameEmbeddingText({
      name: "Long Game",
      summary: longSummary,
      storyline: null,
      keywords: [],
      genres: [],
      platforms: [],
      gameModes: [],
      themes: [],
    });
    expect(text.length).toBeLessThanOrEqual(6000);
    expect(text.endsWith(" ")).toBe(false);
    const tokens = text.split(" ");
    for (const token of tokens) {
      expect(["Long", "Game", "alphabet"]).toContain(token);
    }
  });
});

describe("buildGameRecordFields", () => {
  it("always stamps the current schema_version and never carries a game_id/supabase UUID field (v2 hydrates by igdb_id only)", () => {
    const fields = buildGameRecordFields({
      igdbId: 42,
      slug: "test-game",
      name: "Test Game",
      releaseDate: null,
      genres: [],
      platforms: [],
      gameModes: [],
      coverImageId: null,
      igdbUpdatedAtUnix: null,
    });
    expect(fields.schema_version).toBe(PINECONE_SCHEMA_VERSION);
    expect(fields).not.toHaveProperty("game_id");
    expect(fields).not.toHaveProperty("supabase_game_id");
    expect(fields.igdb_id).toBe(42);
  });

  it("omits null-valued optional fields rather than encoding a null (Pinecone metadata forbids null)", () => {
    const fields = buildGameRecordFields({
      igdbId: 42,
      slug: "test-game",
      name: "Test Game",
      releaseDate: null,
      genres: [],
      platforms: [],
      gameModes: [],
      coverImageId: null,
      igdbUpdatedAtUnix: null,
    });
    expect(fields).not.toHaveProperty("release_year");
    expect(fields).not.toHaveProperty("cover_image_id");
    expect(fields).not.toHaveProperty("game_modes");
    expect(fields).not.toHaveProperty("igdb_updated_at");
  });

  it("derives release_year from releaseDate, caps genre/platform/mode lists at 5, and carries igdb_updated_at when present", () => {
    const fields = buildGameRecordFields({
      igdbId: 42,
      slug: "test-game",
      name: "Test Game",
      releaseDate: "2017-03-03",
      genres: Array.from({ length: 8 }, (_, i) => ({ name: `Genre${i}` })),
      platforms: [{ name: "Switch" }],
      gameModes: Array.from({ length: 8 }, (_, i) => ({ name: `Mode${i}` })),
      coverImageId: "cover-1",
      igdbUpdatedAtUnix: 1_700_000_000,
    });
    expect(fields.release_year).toBe(2017);
    expect(fields.cover_image_id).toBe("cover-1");
    expect((fields.genres as string[]).length).toBe(5);
    expect((fields.platforms as string[])[0]).toBe("Switch");
    expect((fields.game_modes as string[]).length).toBe(5);
    expect(fields.igdb_updated_at).toBe(1_700_000_000);
  });
});
