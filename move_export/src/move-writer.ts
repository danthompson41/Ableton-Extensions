// ---------------------------------------------------------------------------
// Move Set writer — turns a ConvertResult into an on-disk Move Set.
// ---------------------------------------------------------------------------
//
// Layout produced:
//
//   <outDir>/<Set Name>/
//   ├── Song.abl
//   ├── BundleInfo.json        (sample-origin metadata; required by Move Manager)
//   └── Samples/<each referenced file>
//
// That folder *is* a loadable Move Set. The shareable `.ablbundle` is a zip of
// the folder's *contents* (Song.abl / BundleInfo.json / Samples/ at the zip
// ROOT — verified against real bundles; Move Manager rejects a nested layout).

import { mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import * as path from "node:path";
import type { ConvertResult } from "./move-format.js";

export interface WriteResult {
  /** The Set folder that was written. */
  setDir: string;
  /** Sample file names copied into Samples/. */
  copiedSamples: string[];
  /** Samples that could not be copied (missing source, etc.). */
  missingSamples: string[];
}

export async function writeMoveSet(
  outDir: string,
  setName: string,
  result: ConvertResult,
): Promise<WriteResult> {
  const setDir = path.join(outDir, sanitize(setName));
  // Start clean: a stale Samples/ from a previous export would otherwise linger
  // and bloat the bundle (and ship samples the current Set doesn't reference).
  await rm(setDir, { recursive: true, force: true });
  const samplesDir = path.join(setDir, "Samples");
  await mkdir(samplesDir, { recursive: true });

  // Song.abl
  await writeFile(
    path.join(setDir, "Song.abl"),
    JSON.stringify(result.song, null, 2),
    "utf8",
  );

  // Samples/ — dedupe by basename so two clips pointing at the same file copy
  // once. TODO(collisions): two *different* files with the same basename need
  // disambiguation (and the corresponding `sample` field in Song.abl updated).
  const copiedSamples: string[] = [];
  const missingSamples: string[] = [];
  const seen = new Set<string>();
  for (const src of result.sampleSources) {
    const base = path.basename(src);
    if (seen.has(base)) continue;
    seen.add(base);
    try {
      await copyFile(src, path.join(samplesDir, base));
      copiedSamples.push(base);
    } catch {
      missingSamples.push(base);
    }
  }

  // BundleInfo.json — real bundles carry one mapping each bundled `Samples/<x>`
  // to the `ableton:/packs/…` URI it originally came from (used by Move Manager
  // to relink against factory content). Our samples are user files with no
  // factory original, so the map is empty: "everything here is bundled".
  await writeFile(
    path.join(setDir, "BundleInfo.json"),
    JSON.stringify({ originalSampleUris: {} }, null, 2),
    "utf8",
  );

  return { setDir, copiedSamples, missingSamples };
}

/**
 * Zip a written Set folder into `<setDir>.ablbundle`. The bundle's entries are
 * the folder's *contents* at the zip root (Song.abl / BundleInfo.json / Samples/),
 * NOT a nested `<Set>/…` — Move Manager requires the root layout. Best-effort:
 * resolves to the bundle path on success, null if `zip` is unavailable.
 */
export async function bundleSet(setDir: string): Promise<string | null> {
  // Absolute, since we run `zip` with cwd inside the Set folder.
  const bundlePath = path.resolve(`${setDir}.ablbundle`);
  try {
    await run(
      "zip",
      ["-r", "-X", bundlePath, "Song.abl", "BundleInfo.json", "Samples", "-x", ".*"],
      setDir,
    );
    return bundlePath;
  } catch {
    // TODO(bundle): fall back to a JS zip writer so this works without the
    // system `zip` (e.g. on Windows hosts).
    return null;
  }
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}

function sanitize(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_").trim() || "Untitled Set";
}
