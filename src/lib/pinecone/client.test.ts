import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDescribeIndex, mockPcIndex, mockCreateIndexForModel } = vi.hoisted(
  () => ({
    mockDescribeIndex: vi.fn(),
    mockPcIndex: vi.fn(() => ({
      upsertRecords: vi.fn(),
      searchRecords: vi.fn(),
    })),
    mockCreateIndexForModel: vi.fn(),
  }),
);

vi.mock("@pinecone-database/pinecone", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@pinecone-database/pinecone")>();
  class MockPinecone {
    describeIndex = mockDescribeIndex;
    index = mockPcIndex;
    createIndexForModel = mockCreateIndexForModel;
  }
  return { ...actual, Pinecone: MockPinecone };
});

function compatibleIndexModel() {
  return {
    name: "savepoint-games",
    host: "host.svc.pinecone.io",
    metric: "cosine",
    vectorType: "dense",
    spec: {},
    status: { ready: true, state: "Ready" },
    embed: { model: "llama-text-embed-v2", fieldMap: { text: "text" } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

// Each test does a cold vi.resetModules() + dynamic re-import of the module
// graph, which — on the first test in this file — can exceed the default
// 5s timeout purely on transform/import overhead (this project's own test
// runs report multi-minute cumulative "import"/"environment" time). This
// is compile-time cost, not a hang; extending the timeout accommodates it
// without weakening what's actually asserted.
vi.setConfig({ testTimeout: 20_000 });

describe("ensureConfiguredIndex", () => {
  it("never calls createIndexForModel — describes and validates only", async () => {
    mockDescribeIndex.mockResolvedValue(compatibleIndexModel());
    const { ensureConfiguredIndex } = await import("./client");

    await ensureConfiguredIndex();

    expect(mockCreateIndexForModel).not.toHaveBeenCalled();
  });

  it("throws PineconeIndexNotBootstrappedError when the index doesn't exist", async () => {
    const { Errors } = await import("@pinecone-database/pinecone");
    mockDescribeIndex.mockRejectedValue(
      new Errors.PineconeNotFoundError({ status: 404 }),
    );
    const { ensureConfiguredIndex, PineconeIndexNotBootstrappedError } =
      await import("./client");

    await expect(ensureConfiguredIndex()).rejects.toBeInstanceOf(
      PineconeIndexNotBootstrappedError,
    );
    expect(mockCreateIndexForModel).not.toHaveBeenCalled();
    expect(mockPcIndex).not.toHaveBeenCalled();
  });

  it("throws PineconeIndexIncompatibleError for a wrong-model index, without deleting or recreating it", async () => {
    mockDescribeIndex.mockResolvedValue({
      ...compatibleIndexModel(),
      embed: { model: "multilingual-e5-large", fieldMap: { text: "text" } },
    });
    const { ensureConfiguredIndex, PineconeIndexIncompatibleError } =
      await import("./client");

    await expect(ensureConfiguredIndex()).rejects.toBeInstanceOf(
      PineconeIndexIncompatibleError,
    );
    expect(mockCreateIndexForModel).not.toHaveBeenCalled();
  });

  it("memoizes a successful describe — a second call doesn't re-describe", async () => {
    mockDescribeIndex.mockResolvedValue(compatibleIndexModel());
    const { ensureConfiguredIndex } = await import("./client");

    await ensureConfiguredIndex();
    await ensureConfiguredIndex();

    expect(mockDescribeIndex).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure — the next call retries describeIndex", async () => {
    const { Errors } = await import("@pinecone-database/pinecone");
    mockDescribeIndex.mockRejectedValueOnce(
      new Errors.PineconeNotFoundError({ status: 404 }),
    );
    const { ensureConfiguredIndex } = await import("./client");

    await expect(ensureConfiguredIndex()).rejects.toThrow();

    mockDescribeIndex.mockResolvedValueOnce(compatibleIndexModel());
    await expect(ensureConfiguredIndex()).resolves.toBeDefined();
    expect(mockDescribeIndex).toHaveBeenCalledTimes(2);
  });
});
