// Provisions the Japanese Vosk small model for the vosk-browser POC.
//
// vosk-browser loads models as a gzipped tar of the Vosk model folder
// (top-level dir name is auto-detected, so we keep the original name).
// The official alphacephei distribution ships a .zip, so we re-package it
// as .tar.gz and drop it into public/models/ where Next.js can serve it.
//
// Usage: node scripts/fetch-vosk-model.mjs
// Output: public/models/vosk-model-small-ja-0.22.tar.gz  (~48MB, gitignored)

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "vosk-model-small-ja-0.22";
const ZIP_URL = `https://alphacephei.com/vosk/models/${MODEL}.zip`;
const OUT_DIR = join(process.cwd(), "public", "models");
const OUT_TARBALL = join(OUT_DIR, `${MODEL}.tar.gz`);

if (existsSync(OUT_TARBALL)) {
  console.log(`✓ Model already present: ${OUT_TARBALL}`);
  process.exit(0);
}

const work = join(tmpdir(), `vosk-model-${Date.now()}`);
mkdirSync(work, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

try {
  const zip = join(work, `${MODEL}.zip`);
  console.log(`↓ Downloading ${ZIP_URL} (~48MB)...`);
  execSync(`curl -fSL --retry 3 -o "${zip}" "${ZIP_URL}"`, { stdio: "inherit" });

  console.log("⇢ Unzipping...");
  execSync(`unzip -q "${zip}" -d "${work}"`, { stdio: "inherit" });

  console.log("⇢ Re-packaging as gzipped tar for vosk-browser...");
  // -C so the tarball's top-level entry is exactly `${MODEL}/`
  execSync(`tar czf "${OUT_TARBALL}" -C "${work}" "${MODEL}"`, {
    stdio: "inherit",
  });

  console.log(`✓ Wrote ${OUT_TARBALL}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
