// Copies `public/` and `.next/static/` into the Next.js standalone output
// directory. Next's `output: "standalone"` trace deliberately does not
// include either directory — copying them in is a documented, required
// manual step, independent of Next.js version. Cross-platform (Node's own
// fs.rm/fs.cp), no shell `cp`/`xcopy`. Runs automatically as part of
// `npm run build` / `npm run build:turbo`.
//
// Run directly with: node scripts/prepare-standalone.mts

import { rm, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

export interface CopyTarget {
  label: string;
  src: string;
  dest: string;
}

/**
 * Pure and side-effect-free so the exact copy targets are assertable
 * without touching the filesystem. `root` defaults to the real project
 * root but is overridable for tests.
 */
export function getStandaloneCopyTargets(
  root: string = projectRoot,
): CopyTarget[] {
  return [
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
  ];
}

/**
 * Replaces `dest` with a fresh copy of `src`. Removes `dest` first (rather
 * than a plain `fs.cp` with `force: true`, which only overwrites files
 * still present in `src` — it never removes a dest file that was since
 * deleted from src) so nothing from a previous build lingers.
 */
export async function copyStandaloneAsset(target: CopyTarget): Promise<void> {
  await rm(target.dest, { recursive: true, force: true });
  await cp(target.src, target.dest, { recursive: true });
}

async function main(): Promise<void> {
  for (const target of getStandaloneCopyTargets()) {
    await copyStandaloneAsset(target);
    console.log(
      `Copied ${target.label} -> ${path.relative(projectRoot, target.dest)}`,
    );
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error: unknown) => {
    console.error("prepare-standalone failed:", error);
    process.exit(1);
  });
}
