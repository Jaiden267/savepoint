import { describe, it, expect } from "vitest";
import {
  pineconeCatalogueRecordSchema,
  catalogueImportIgdbIdSchema,
} from "./games";
import { PINECONE_SCHEMA_VERSION } from "@/lib/pinecone/constants";

const VALID_V2_RECORD = {
  schema_version: PINECONE_SCHEMA_VERSION,
  igdb_id: 42,
  slug: "test-game",
  name: "Test Game",
  cover_image_id: "cover-1",
  release_year: 2020,
};

describe("pineconeCatalogueRecordSchema", () => {
  it("accepts a valid v2 record, including optional fields omitted", () => {
    const { schema_version, igdb_id, slug, name } = VALID_V2_RECORD;
    const result = pineconeCatalogueRecordSchema.safeParse({
      schema_version,
      igdb_id,
      slug,
      name,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid v2 record with optional fields present", () => {
    const result = pineconeCatalogueRecordSchema.safeParse(VALID_V2_RECORD);
    expect(result.success).toBe(true);
  });

  it("rejects a legacy v1-shaped record (no schema_version) — the exact shape every existing Pinecone record had before Prompt 7C", () => {
    const result = pineconeCatalogueRecordSchema.safeParse({
      igdb_id: 42,
      slug: "test-game",
      name: "Test Game",
      genres: ["Adventure"],
      platforms: ["Switch"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a record whose schema_version doesn't match the current constant", () => {
    const result = pineconeCatalogueRecordSchema.safeParse({
      ...VALID_V2_RECORD,
      schema_version: PINECONE_SCHEMA_VERSION + 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a record missing a required field (slug)", () => {
    const { slug: _slug, ...withoutSlug } = VALID_V2_RECORD;
    const result = pineconeCatalogueRecordSchema.safeParse(withoutSlug);
    expect(result.success).toBe(false);
  });

  it("rejects an invalid slug shape", () => {
    const result = pineconeCatalogueRecordSchema.safeParse({
      ...VALID_V2_RECORD,
      slug: "Not A Valid Slug!",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive igdb_id", () => {
    const result = pineconeCatalogueRecordSchema.safeParse({
      ...VALID_V2_RECORD,
      igdb_id: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe("catalogueImportIgdbIdSchema", () => {
  it("accepts a positive integer, including as a string (form field values arrive as strings)", () => {
    expect(catalogueImportIgdbIdSchema.safeParse(42).success).toBe(true);
    expect(catalogueImportIgdbIdSchema.safeParse("42").success).toBe(true);
  });

  it("rejects zero, negative, non-numeric, and non-integer values", () => {
    expect(catalogueImportIgdbIdSchema.safeParse(0).success).toBe(false);
    expect(catalogueImportIgdbIdSchema.safeParse(-5).success).toBe(false);
    expect(catalogueImportIgdbIdSchema.safeParse("not-a-number").success).toBe(
      false,
    );
    expect(catalogueImportIgdbIdSchema.safeParse(4.5).success).toBe(false);
  });

  it("rejects null/undefined (a missing form field)", () => {
    expect(catalogueImportIgdbIdSchema.safeParse(null).success).toBe(false);
    expect(catalogueImportIgdbIdSchema.safeParse(undefined).success).toBe(
      false,
    );
  });
});
