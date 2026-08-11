import { describe, it, expect } from "vitest";
import { normalizeGameName } from "./normalize";

describe("normalizeGameName", () => {
  it("lowercases", () => {
    expect(normalizeGameName("HALO")).toBe("halo");
  });

  it("strips diacritics", () => {
    expect(normalizeGameName("Pokémon")).toBe("pokemon");
  });

  it("replaces punctuation with spaces", () => {
    expect(normalizeGameName("Marvel's Spider-Man: Miles Morales")).toBe(
      "marvel s spider man miles morales",
    );
  });

  it("collapses repeated whitespace", () => {
    expect(normalizeGameName("The   Legend  of Zelda")).toBe(
      "the legend of zelda",
    );
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeGameName("  Halo  ")).toBe("halo");
  });

  it("returns an empty string for an all-punctuation input", () => {
    expect(normalizeGameName("!!!")).toBe("");
  });

  it("matches the documented worked example", () => {
    expect(normalizeGameName("Pokemon: Let's Go, Pikachu!")).toBe(
      "pokemon let s go pikachu",
    );
  });

  it("is idempotent", () => {
    const once = normalizeGameName("The Legend of Zelda: Breath of the Wild");
    expect(normalizeGameName(once)).toBe(once);
  });
});
