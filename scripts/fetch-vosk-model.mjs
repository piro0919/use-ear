// Prepares Vosk small models as the .tar.gz that vosk-browser expects (multi-language).
//
// vosk-browser loads models as a gzipped tar of the Vosk model folder
// (top-level dir name is auto-detected, so we keep the original name).
// The official alphacephei distribution ships a .zip, so we re-package each as
// .tar.gz into public/models/ (gitignored). From there:
//   - local dev: Next.js serves them same-origin at /models/<model>.tar.gz, or
//   - hosting:   upload to your CDN (e.g. Cloudflare R2) and point the hook's
//                `models` / `modelUrl` at those URLs. The library's DEFAULT_MODELS
//                point at an R2 bucket populated exactly this way.
//
// Usage:
//   node scripts/fetch-vosk-model.mjs            # provision the default set (ja, en)
//   node scripts/fetch-vosk-model.mjs ja en fr   # provision specific languages
// Output: public/models/<model>.tar.gz  (~40-90MB each, gitignored)

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Vosk small models (browser/mobile-friendly, Apache-2.0). lang -> model name.
const MODELS = {
  ja: "vosk-model-small-ja-0.22",
  en: "vosk-model-small-en-us-0.15",
  cn: "vosk-model-small-cn-0.22",
  ko: "vosk-model-small-ko-0.22",
  es: "vosk-model-small-es-0.42",
  fr: "vosk-model-small-fr-0.22",
  de: "vosk-model-small-de-0.15",
};

const DEFAULT_LANGS = ["ja", "en"];

const langs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT_LANGS;

const OUT_DIR = join(process.cwd(), "public", "models");
mkdirSync(OUT_DIR, { recursive: true });

for (const lang of langs) {
  const model = MODELS[lang];
  if (!model) {
    console.warn(
      `⚠ Unknown language "${lang}" (known: ${Object.keys(MODELS).join(", ")})`,
    );
    continue;
  }
  const outTarball = join(OUT_DIR, `${model}.tar.gz`);
  if (existsSync(outTarball)) {
    console.log(`✓ Already present: ${model}.tar.gz`);
    continue;
  }

  const work = join(tmpdir(), `vosk-model-${lang}-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  try {
    const zipUrl = `https://alphacephei.com/vosk/models/${model}.zip`;
    const zip = join(work, `${model}.zip`);
    console.log(`↓ [${lang}] Downloading ${zipUrl} ...`);
    execSync(`curl -fSL --retry 3 -o "${zip}" "${zipUrl}"`, {
      stdio: "inherit",
    });

    console.log(`⇢ [${lang}] Unzipping...`);
    execSync(`unzip -q "${zip}" -d "${work}"`, { stdio: "inherit" });

    console.log(`⇢ [${lang}] Re-packaging as gzipped tar...`);
    // -C so the tarball's top-level entry is exactly `${model}/`
    execSync(`tar czf "${outTarball}" -C "${work}" "${model}"`, {
      stdio: "inherit",
    });

    console.log(`✓ Wrote ${outTarball}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
