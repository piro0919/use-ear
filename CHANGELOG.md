# Changelog

## 1.4.0

### Added

- **`maxPartialChars`** (default `40`) — rebuild a language's recognizer once its
  partial result grows past the limit. Vosk only finalizes an utterance when it
  detects silence, so in a room that never goes quiet the partial grows without
  bound. A new utterance is then read as a continuation of everything before it
  and the wake word comes back as a different word; matching also gets slower in
  proportion to the partial's length. Measured with synthetic speech fed through a
  virtual microphone, holding everything constant but the moment of the utterance:
  spoken at 5 s it matched with a 43-character partial, spoken at 120 s it failed
  three times out of three with the partial pinned at 200 characters, and with the
  recognizer rebuilt it matched three times out of three at 45 characters. The
  microphone and `AudioContext` are reused, so there is no gap where the hook stops
  hearing. The partial is matched before the cut, so a wake word at the tail of an
  overgrown partial still fires. Set it to `0` for the previous behavior.

## 1.3.0

### Added

- **`audioSource: "external"` / `pushAudio()` / `flush()`** — let the caller own
  the microphone. Until now `start()` opened the device and `stop()` closed it,
  so an app that also needs the same microphone for something else had to reopen
  it on every stop/start. On mobile that costs hundreds of milliseconds to
  seconds, and the speech in that gap is lost outright: once the first couple of
  characters are missing, fuzzy matching drops below threshold and the wake word
  does not fire at all. With `audioSource: "external"` the hook never touches
  the microphone — you keep one stream open and feed frames in with
  `pushAudio(samples, sampleRate)`. Recognizers are built from the first frame's
  sample rate and rebuilt if it changes. `flush()` cuts an utterance boundary
  for callers that pause and resume the feed; the text it flushes is
  deliberately not matched, since it is the tail of what was said before the
  pause and matching it would fire the same wake word a second time the moment
  feeding resumes. The default (`"microphone"`) is unchanged.

## 1.2.0

### Added

- **`keepAudioSeconds` / `getRecentAudio()`** — keep the last few seconds of audio
  and read them back after a wake word fires. The detection already happened
  inside the hook, so callers had no way to get at the voice that triggered it;
  this hands it over as 16 kHz mono float32, ready for speaker verification or
  anything else that needs the audio rather than the transcript. Off by default
  (`0`), and the ring buffer is discarded on `stop()`. One second costs about
  64 KB.

## 1.1.2

### Fixed

- **Reverted the single-download change from 1.1.1 — it broke model loading.**
  Handing the fetched bytes to `createModel` as a blob URL meant the archive
  arrived decompressed, and extraction failed with "Unrecognized archive
  format", leaving the hook without a model. The archive URL is passed through
  again, so the model is fetched twice on first load (once for progress, once
  by `createModel`) as it was before 1.1.1. Everything else in 1.1.1 stands.

## 1.1.1

### Fixed

- **`useEarVosk` could run several listening sessions at once, wrecking
  recognition.** `start()` guarded against re-entry with the `status` state, so
  calls made before React re-rendered all saw `idle` and went through. Each one
  took its own microphone and audio graph, and because the processor read the
  recognizer list through a ref, every graph fed the *current* recognizer. The
  same audio arrived two to five times over, so speech decoded as a much longer
  utterance: a Japanese wake word came back as unrelated words. The guard is now
  a ref, and each audio graph only feeds the recognizers it created.
- **A `stop()` during startup left the hook wedged.** `start()` awaits the model
  load and the microphone, and a tab moved to the background never resolves
  `getUserMedia`. The pending start held the guard forever and every later
  `start()` was refused. Startup now carries a generation number: `stop()`
  advances it, and an interrupted start releases the microphone and audio
  context it opened, then bows out.

### Changed

- **The model is downloaded once instead of twice.** Progress reporting fetched
  the archive, threw the bytes away, and let `createModel` fetch it again — tens
  of megabytes twice over, which doubles the wait on a weak connection. The
  fetched bytes are now handed straight to `createModel`.
- **Models and load progress are shared across hook instances.** They used to be
  per-instance, so a route change that remounted the listener re-downloaded and
  re-extracted the model, and a second instance showed no progress for a
  download already running. Both now live at module scope; models are released
  60 seconds after the last consumer unmounts, since a navigation unmounts
  before it mounts again. Models are keyed by language, so consumers on one page
  should use the same model URL per language.

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
