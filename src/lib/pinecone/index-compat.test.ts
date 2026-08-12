import { describe, it, expect } from "vitest";
import { isIndexCompatible, describeIncompatibility } from "./index-compat";
import type { IndexModel } from "@pinecone-database/pinecone";

function makeIndexModel(embed: IndexModel["embed"] | undefined): IndexModel {
  return {
    name: "savepoint-games",
    metric: "cosine",
    host: "host.svc.pinecone.io",
    spec: {} as IndexModel["spec"],
    status: { ready: true, state: "Ready" } as IndexModel["status"],
    vectorType: "dense",
    embed,
  };
}

describe("isIndexCompatible", () => {
  it("returns true for a matching model and fieldMap", () => {
    const model = makeIndexModel({
      model: "llama-text-embed-v2",
      fieldMap: { text: "text" },
    });
    expect(isIndexCompatible(model)).toBe(true);
  });

  it("returns false for a mismatched model", () => {
    const model = makeIndexModel({
      model: "multilingual-e5-large",
      fieldMap: { text: "text" },
    });
    expect(isIndexCompatible(model)).toBe(false);
  });

  it("returns false for a mismatched field map", () => {
    const model = makeIndexModel({
      model: "llama-text-embed-v2",
      fieldMap: { text: "chunk_text" },
    });
    expect(isIndexCompatible(model)).toBe(false);
  });

  it("returns false when embed is entirely missing (no integrated inference configured)", () => {
    expect(isIndexCompatible(makeIndexModel(undefined))).toBe(false);
  });
});

describe("describeIncompatibility", () => {
  it("describes a missing embed config", () => {
    const detail = describeIncompatibility(makeIndexModel(undefined));
    expect(detail).toContain("no integrated embedding");
  });

  it("describes a model mismatch by name", () => {
    const detail = describeIncompatibility(
      makeIndexModel({
        model: "multilingual-e5-large",
        fieldMap: { text: "text" },
      }),
    );
    expect(detail).toContain("multilingual-e5-large");
    expect(detail).toContain("llama-text-embed-v2");
  });

  it("describes a fieldMap mismatch", () => {
    const detail = describeIncompatibility(
      makeIndexModel({
        model: "llama-text-embed-v2",
        fieldMap: { text: "chunk_text" },
      }),
    );
    expect(detail).toContain("chunk_text");
  });
});
