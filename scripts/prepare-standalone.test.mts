import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readdir,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getStandaloneCopyTargets,
  copyStandaloneAsset,
} from "./prepare-standalone.mts";

describe("getStandaloneCopyTargets", () => {
  it("points at public/ and .next/static/ under the given root, copying into .next/standalone", () => {
    const root = path.join("project-root");
    const targets = getStandaloneCopyTargets(root);

    expect(targets).toEqual([
      {
        label: "public",
        src: path.join(root, "public"),
        dest: path.join(root, ".next", "standalone", "public"),
      },
      {
        label: ".next/static",
        src: path.join(root, ".next", "static"),
        dest: path.join(root, ".next", "standalone", ".next", "static"),
      },
    ]);
  });
});

describe("copyStandaloneAsset", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "savepoint-standalone-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("copies fresh files from src to dest", async () => {
    const src = path.join(root, "public");
    const dest = path.join(root, "standalone", "public");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "favicon.ico"), "icon-bytes");

    await copyStandaloneAsset({ label: "public", src, dest });

    const copied = await readFile(path.join(dest, "favicon.ico"), "utf8");
    expect(copied).toBe("icon-bytes");
  });

  it("removes a stale file that exists in dest but no longer in src", async () => {
    const src = path.join(root, "public");
    const dest = path.join(root, "standalone", "public");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "current.txt"), "current");
    await mkdir(dest, { recursive: true });
    await writeFile(
      path.join(dest, "stale.txt"),
      "leftover from a previous build",
    );

    await copyStandaloneAsset({ label: "public", src, dest });

    const entries = await readdir(dest);
    expect(entries.sort()).toEqual(["current.txt"]);
  });

  it("overwrites a file whose content changed between builds", async () => {
    const src = path.join(root, "static");
    const dest = path.join(root, "standalone", "static");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "chunk.js"), "new-build-content");
    await mkdir(dest, { recursive: true });
    await writeFile(path.join(dest, "chunk.js"), "old-build-content");

    await copyStandaloneAsset({ label: ".next/static", src, dest });

    const content = await readFile(path.join(dest, "chunk.js"), "utf8");
    expect(content).toBe("new-build-content");
  });
});
