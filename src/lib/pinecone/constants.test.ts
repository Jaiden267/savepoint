import { describe, it, expect } from "vitest";
import { buildCatalogueRecordId } from "./constants";

describe("buildCatalogueRecordId", () => {
  it("builds the canonical v2 record id shape", () => {
    expect(buildCatalogueRecordId(42)).toBe("igdb-42");
  });

  it("is the single source of the igdb- prefix — never reconstructed inline elsewhere", () => {
    expect(buildCatalogueRecordId(314293)).toBe("igdb-314293");
  });
});
