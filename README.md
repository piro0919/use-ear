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

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `wakeWords` | `(string \| WakeWord)[]` | required | Wake words to detect |
| `onWakeWord` | `(word: string, transcript: string) => void` | required | Callback when wake word is detected |
| `stopWords` | `(string \| WakeWord)[]` | `[]` | Words that stop listening when detected |
| `onStopWord` | `(word: string, transcript: string) => void` | - | Callback when stop word is detected |
| `language` | `string` | `"ja-JP"` | Default language for speech recognition |
| `continuous` | `boolean` | `true` | Keep listening after detection |
| `caseSensitive` | `boolean` | `false` | Case-sensitive matching |
| `keepAlive` | `boolean` | `true` | Keep audio session alive (for mobile) |
| `screenLock` | `boolean` | `false` | Prevent screen from sleeping (Wake Lock API) |

### Return Values

| Value | Type | Description |
|-------|------|-------------|
| `isListening` | `boolean` | Currently listening |
| `isSupported` | `boolean` | Browser supports Web Speech API |
| `start` | `() => void` | Start listening |
| `stop` | `() => void` | Stop listening |
| `error` | `Error \| null` | Error if any |
| `transcript` | `string` | Last recognized text |

## API — `useEarVosk` (on-device)

Requires the optional peer dependency: `npm install vosk-browser`.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `wakeWords` | `(string \| WakeWord)[]` | required | Wake words to detect (per-word `language`) |
| `onWakeWord` | `(word: string, transcript: string) => void` | required | Callback when a wake word is detected |
| `stopWords` | `(string \| WakeWord)[]` | `[]` | Words that stop listening when detected |
| `onStopWord` | `(word: string, transcript: string) => void` | - | Callback when a stop word is detected |
| `models` | `Record<string, string>` | - | `language` → model `.tar.gz` URL. Multiple entries load in parallel and match each language against its own recognizer |
| `modelUrl` | `string` | - | Single-model URL (used when `models` is omitted) |
| `language` | `string` | `"ja-JP"` | Language for bare-string words, and the single default model |
| `caseSensitive` | `boolean` | `false` | Case-sensitive matching |
| `normalize` | `boolean` | `true` | Normalize text before matching |
| `similarityThreshold` | `number` | - | Fuzzy-match threshold (0–1). Omit for exact substring matching |
| `useGrammar` | `boolean` | `false` | Constrain recognition to your wake/stop words per language (improves short-phrase accuracy; may error on words outside the model vocabulary) |
| `onTranscript` | `(text: string, info: { isFinal: boolean; language: string }) => void` | - | Recognition update callback (includes partials) |

Model resolution: `models` wins; otherwise the single `language` model is taken from `modelUrl` or, if omitted, from `DEFAULT_MODELS[language]` (the default CDN).

### Return Values

| Value | Type | Description |
|-------|------|-------------|
| `status` | `"idle" \| "loading-model" \| "requesting-mic" \| "listening" \| "error"` | Engine state |
| `isListening` | `boolean` | Currently listening |
| `isSupported` | `boolean` | Environment can run on-device STT (AudioContext + getUserMedia + WebAssembly). `false` during SSR; resolves after mount |
| `loadProgress` | `number \| null` | Model download progress (0–1) |
| `preload` | `() => Promise<void>` | Warm the model(s) before `start()` |
| `start` | `() => Promise<void>` | Start listening (loads models if needed) |
| `stop` | `() => void` | Stop listening (keeps models in memory for the next start) |
| `error` | `Error \| null` | Error if any |
| `transcript` | `string` | Last final recognized text |
| `partial` | `string` | Current in-progress text |
| `metrics` | `VoskMetrics` | On-device diagnostics: model load time/size, model count, main-thread frame timing, audio-chunk cost |

## Browser Support

Web Speech API is supported in:
- Chrome (Desktop & Android)
- Safari (Desktop & iOS)
- Edge

## Development

```bash
# Install dependencies
npm install

# Run demo
npm run dev

# Build library
npm run build:lib

# Lint
npm run lint
```

## License

MIT
