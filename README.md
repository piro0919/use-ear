# use-ear

React hooks for wake word detection. Two interchangeable engines:

- **`useEar`** — Web Speech API. Zero extra dependencies.
- **`useEarVosk`** — on-device STT via [vosk-browser](https://github.com/ccoreilly/vosk-browser) (Vosk/Kaldi WASM). Runs fully client-side, so it does **not** trigger the OS speech-recognition "earcon" beep on mobile and does true continuous listening without session restarts.

**Demo:** <https://use-ear.kkweb.io/> · on-device demo: <https://use-ear.kkweb.io/vosk>

## Features

- Wake word detection with customizable keywords
- Multi-language support with per-word language settings
- Mobile-friendly with audio session keep-alive
- On-device, earcon-free engine option (no OS speech service, no network at inference time)
- TypeScript support

## Installation

```bash
npm install use-ear
```

## Usage

### Basic Usage

```tsx
import { useEar } from "use-ear";

function App() {
  const { isListening, isSupported, start, stop, transcript } = useEar({
    wakeWords: ["hello", "hey"],
    onWakeWord: (word, transcript) => {
      console.log(`Detected: ${word}`);
    },
    language: "en-US",
  });

  return (
    <div>
      <button onClick={isListening ? stop : start}>
        {isListening ? "Stop" : "Start"}
      </button>
      <p>Transcript: {transcript}</p>
    </div>
  );
}
```

### Multi-language Support

You can specify different languages for each wake word:

```tsx
useEar({
  wakeWords: [
    { word: "hello", language: "en-US" },
    { word: "hey", language: "en-US" },
    { word: "konnichiwa", language: "ja-JP" },
    { word: "ookei", language: "ja-JP" },
  ],
  onWakeWord: (word) => {
    console.log(`Detected: ${word}`);
  },
});
```

The recognition engine rotates through languages automatically.

### Stop Words

You can specify stop words to automatically stop listening:

```tsx
useEar({
  wakeWords: ["hello", "hey"],
  onWakeWord: (word) => {
    console.log(`Detected: ${word}`);
  },
  stopWords: ["stop", "cancel"],
  onStopWord: (word) => {
    console.log(`Stopped by: ${word}`);
  },
});
```

### Screen Lock (Prevent Sleep)

Enable `screenLock` to prevent the screen from sleeping during listening:

```tsx
useEar({
  wakeWords: ["hello"],
  onWakeWord: (word) => {
    console.log(`Detected: ${word}`);
  },
  screenLock: true, // Keeps screen awake
});
```

This uses the Wake Lock API to prevent the device from dimming or locking the screen. Useful for hands-free applications where you need continuous listening.

## On-device engine (`useEarVosk`)

`useEar` uses the OS Web Speech API, which on mobile plays a recognition "earcon" beep on every session restart. To avoid that, `useEarVosk` runs speech recognition on-device with vosk-browser — no OS speech service, no earcon, and true continuous listening.

`vosk-browser` is an **optional peer dependency**, so only install it if you use this engine:

```bash
npm install vosk-browser
```

```tsx
import { useEarVosk } from "use-ear";

function App() {
  const { isListening, start, stop, transcript } = useEarVosk({
    wakeWords: [{ word: "こんにちは", language: "ja-JP" }],
    onWakeWord: (word) => console.log(`Detected: ${word}`),
    // language defaults to "ja-JP"; the model is fetched from the default CDN
  });

  return (
    <button onClick={isListening ? stop : start}>
      {isListening ? "Stop" : "Start"} — {transcript}
    </button>
  );
}
```

### Models

Vosk needs a language model (a `.tar.gz` of a Vosk "small" model). It is **never bundled** in this package — you point the hook at a URL.

- **Default (zero-config):** if you pass neither `models` nor `modelUrl`, the hook loads the model for `language` from a convenience CDN (Cloudflare R2, CORS-enabled). See `DEFAULT_MODELS` for the list of built-in language URLs.
- **Multiple languages at once:** pass a `models` map. Every model is loaded in parallel and the same audio is matched against each (words are matched only against the recognizer of their own `language`).

  ```tsx
  import { useEarVosk, DEFAULT_MODELS } from "use-ear";

  useEarVosk({
    wakeWords: [
      { word: "こんにちは", language: "ja-JP" },
      { word: "hello", language: "en-US" },
    ],
    models: {
      "ja-JP": DEFAULT_MODELS["ja-JP"],
      "en-US": DEFAULT_MODELS["en-US"],
    },
    onWakeWord: (word) => console.log(word),
  });
  ```

- **Self-hosting (recommended for production):** the default CDN is a convenience, not an SLA. For production, host the model tarballs yourself and pass your own URLs so availability is under your control:

  ```tsx
  useEarVosk({
    wakeWords: [{ word: "hello", language: "en-US" }],
    modelUrl: "/models/vosk-model-small-en-us-0.15.tar.gz", // same-origin, no CORS needed
    language: "en-US",
    onWakeWord: (word) => console.log(word),
  });
  ```

  To prepare tarballs, use `scripts/fetch-vosk-model.mjs` (downloads the official Vosk zip and re-packages it as the `.tar.gz` vosk-browser expects). Serving them same-origin needs no CORS; serving cross-origin requires `Access-Control-Allow-Origin`. Because Vosk models are large (~40–90 MB each), a host with free egress (e.g. Cloudflare R2) is recommended.

> Tip: `useGrammar` constrains recognition to your wake/stop words per language, which noticeably improves accuracy for short phrases.

## API — `useEar` (Web Speech API)

### Options

| Option          | Type                                         | Default   | Description                                  |
| --------------- | -------------------------------------------- | --------- | -------------------------------------------- |
| `wakeWords`     | `(string \| WakeWord)[]`                     | required  | Wake words to detect                         |
| `onWakeWord`    | `(word: string, transcript: string) => void` | required  | Callback when wake word is detected          |
| `stopWords`     | `(string \| WakeWord)[]`                     | `[]`      | Words that stop listening when detected      |
| `onStopWord`    | `(word: string, transcript: string) => void` | -         | Callback when stop word is detected          |
| `language`      | `string`                                     | `"ja-JP"` | Default language for speech recognition      |
| `continuous`    | `boolean`                                    | `true`    | Keep listening after detection               |
| `caseSensitive` | `boolean`                                    | `false`   | Case-sensitive matching                      |
| `keepAlive`     | `boolean`                                    | `true`    | Keep audio session alive (for mobile)        |
| `screenLock`    | `boolean`                                    | `false`   | Prevent screen from sleeping (Wake Lock API) |

### Return Values

| Value         | Type            | Description                     |
| ------------- | --------------- | ------------------------------- |
| `isListening` | `boolean`       | Currently listening             |
| `isSupported` | `boolean`       | Browser supports Web Speech API |
| `start`       | `() => void`    | Start listening                 |
| `stop`        | `() => void`    | Stop listening                  |
| `error`       | `Error \| null` | Error if any                    |
| `transcript`  | `string`        | Last recognized text            |

## API — `useEarVosk` (on-device)

Requires the optional peer dependency: `npm install vosk-browser`.

### Options

| Option                | Type                                                                   | Default        | Description                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wakeWords`           | `(string \| WakeWord)[]`                                               | required       | Wake words to detect (per-word `language`)                                                                                                        |
| `onWakeWord`          | `(word: string, transcript: string) => void`                           | required       | Callback when a wake word is detected                                                                                                             |
| `stopWords`           | `(string \| WakeWord)[]`                                               | `[]`           | Words that stop listening when detected                                                                                                           |
| `onStopWord`          | `(word: string, transcript: string) => void`                           | -              | Callback when a stop word is detected                                                                                                             |
| `models`              | `Record<string, string>`                                               | -              | `language` → model `.tar.gz` URL. Multiple entries load in parallel and match each language against its own recognizer                            |
| `modelUrl`            | `string`                                                               | -              | Single-model URL (used when `models` is omitted)                                                                                                  |
| `language`            | `string`                                                               | `"ja-JP"`      | Language for bare-string words, and the single default model                                                                                      |
| `caseSensitive`       | `boolean`                                                              | `false`        | Case-sensitive matching                                                                                                                           |
| `normalize`           | `boolean`                                                              | `true`         | Normalize text before matching                                                                                                                    |
| `similarityThreshold` | `number`                                                               | -              | Fuzzy-match threshold (0–1). Omit for exact substring matching                                                                                    |
| `useGrammar`          | `boolean`                                                              | `false`        | Constrain recognition to your wake/stop words per language (improves short-phrase accuracy; may error on words outside the model vocabulary)      |
| `onTranscript`        | `(text: string, info: { isFinal: boolean; language: string }) => void` | -              | Recognition update callback (includes partials)                                                                                                   |
| `keepAudioSeconds`    | `number`                                                               | `0`            | Keep the last N seconds of audio in a ring buffer so `getRecentAudio()` can return the voice that said the wake word (speaker verification, etc.) |
| `audioSource`         | `"microphone" \| "external"`                                           | `"microphone"` | Where audio comes from. `"external"` never touches the microphone — you feed frames in with `pushAudio()`                                         |
| `maxPartialChars`     | `number`                                                               | `40`           | Rebuild a language's recognizer once its partial grows this long. `0` disables it. See "Noisy rooms" below                                        |

Model resolution: `models` wins; otherwise the single `language` model is taken from `modelUrl` or, if omitted, from `DEFAULT_MODELS[language]` (the default CDN).

### Return Values

| Value            | Type                                                                      | Description                                                                                                             |
| ---------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `status`         | `"idle" \| "loading-model" \| "requesting-mic" \| "listening" \| "error"` | Engine state                                                                                                            |
| `isListening`    | `boolean`                                                                 | Currently listening                                                                                                     |
| `isSupported`    | `boolean`                                                                 | Environment can run on-device STT (AudioContext + getUserMedia + WebAssembly). `false` during SSR; resolves after mount |
| `loadProgress`   | `number \| null`                                                          | Model download progress (0–1)                                                                                           |
| `preload`        | `() => Promise<void>`                                                     | Warm the model(s) before `start()`                                                                                      |
| `start`          | `() => Promise<void>`                                                     | Start listening (loads models if needed)                                                                                |
| `stop`           | `() => void`                                                              | Stop listening (keeps models in memory for the next start)                                                              |
| `error`          | `Error \| null`                                                           | Error if any                                                                                                            |
| `transcript`     | `string`                                                                  | Last final recognized text                                                                                              |
| `partial`        | `string`                                                                  | Current in-progress text                                                                                                |
| `metrics`        | `VoskMetrics`                                                             | On-device diagnostics: model load time/size, model count, main-thread frame timing, audio-chunk cost                    |
| `getRecentAudio` | `(seconds?: number) => Float32Array \| null`                              | Last N seconds of audio as 16 kHz mono float32. `null` unless `keepAudioSeconds` is set and listening                   |
| `pushAudio`      | `(samples: Float32Array, sampleRate: number) => void`                     | Feed audio in when `audioSource: "external"`. No-op otherwise                                                           |
| `flush`          | `() => void`                                                              | Cut an utterance boundary and drop the recognizer's pending text. The text it flushes is not matched against wake words |

### Sharing one microphone (`audioSource: "external"`)

By default `start()` opens the microphone itself and `stop()` closes it. If your app
also needs the same microphone for something else — a call, a cloud transcription
service — reopening the device on every stop/start costs anywhere from a few hundred
milliseconds to seconds on mobile, and whatever the user says during that gap is lost.

With `audioSource: "external"` the hook never touches the microphone. You own the
stream, and you decide who gets the frames:

```tsx
const { flush, pushAudio, start } = useEarVosk({
  audioSource: "external",
  wakeWords: ["hey assistant"],
  onWakeWord: (word) => console.log(word),
});

useEffect(() => {
  void start(); // loads models only — no getUserMedia, no AudioContext
}, [start]);

// your own audio graph, opened once and kept open
processor.onaudioprocess = (event) => {
  const frame = event.inputBuffer.getChannelData(0);
  if (!recording) pushAudio(frame, event.inputBuffer.sampleRate);
  else sendToYourTranscriptionService(frame);
};
```

Recognizers are created on the first `pushAudio()` call, using that frame's sample
rate, and rebuilt if the rate changes. Call `flush()` when you resume feeding after a
pause, so the words spoken before the pause are not read as the start of the new
utterance — and, importantly, are not matched as a wake word a second time.

### Noisy rooms (`maxPartialChars`)

Vosk only finalizes an utterance when it detects silence. Somewhere that never goes
quiet — a TV, a radio, people talking through a shift — it never does, so the partial
result grows without bound. Two things then go wrong: a new utterance is read as a
continuation of everything before it and the wake word comes back as some other word,
and matching gets slower in proportion to the partial's length (a 120-character
partial spends roughly 463 ms of the main thread per second on matching alone).

`maxPartialChars` (default `40`) rebuilds that language's recognizer once its partial
reaches the limit. The microphone and `AudioContext` are reused, so there is no gap
where the hook stops hearing — rebuilding 26 times over two minutes dropped nothing in
testing. Wake words are at most a dozen or so characters, so cutting the partial does
not cost you a detection; the text is matched before the cut, so a wake word sitting at
the tail of an overgrown partial still fires.

Set it to `0` to keep the old behavior.

## Browser Support

Web Speech API is supported in:

- Chrome (Desktop & Android)
- Safari (Desktop & iOS)
- Edge

## Development

```bash
# Install dependencies
pnpm install

# Run demo
pnpm dev

# Build library
pnpm build:lib

# Lint
pnpm lint
```

## License

MIT