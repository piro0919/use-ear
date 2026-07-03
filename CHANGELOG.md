# Changelog

## 1.1.0

### Added

- **`useEarVosk`** — a new on-device speech-to-text engine built on
  [vosk-browser](https://github.com/ccoreilly/vosk-browser) (Vosk/Kaldi WASM).
  Unlike `useEar` (Web Speech API), it runs fully client-side, so it does **not**
  trigger the OS speech-recognition "earcon" beep on mobile and does true
  continuous listening without session restarts.
  - Multi-language: pass a `models: Record<lang, url>` map to load several
    language models in parallel; each language is matched only against its own
    recognizer.
  - `preload()` to warm the WASM model before `start()`.
  - `metrics` for on-device diagnostics (model load time, main-thread frame
    timing, audio-chunk cost, model count).
  - `isSupported` reports whether the environment can run the on-device engine
    (AudioContext + getUserMedia + WebAssembly).
  - `useGrammar` (default `false`) constrains recognition to your wake/stop
    words per language, improving accuracy for short phrases.
- **`DEFAULT_MODELS`** — a map of language → model URL served from a
  CORS-enabled CDN (Cloudflare R2), used as the zero-config default. Override
  with `models` / `modelUrl` to self-host.
- Exposed the shared, backend-agnostic matching utilities: `normalizeText`,
  `transformForMatch`, `matchWord`, `fuzzyIncludes`, `levenshtein`,
  `normalizeWakeWords`, `getUniqueLanguages`.

### Changed

- `vosk-browser` is now an **optional** `peerDependency` (was a direct
  dependency). It is dynamically imported, so consumers who only use `useEar`
  (Web Speech API) do not need to install it. Install it only for the on-device
  engine: `npm install vosk-browser`.

## 1.0.0

- Initial release: `useEar` wake-word detection via the Web Speech API.
