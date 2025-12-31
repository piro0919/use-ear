# use-ear

React hooks for wake word detection using Web Speech API.

**Demo:** <https://use-ear.kkweb.io/>

## Features

- Wake word detection with customizable keywords
- Multi-language support with per-word language settings
- Mobile-friendly with audio session keep-alive
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
    { word: "ヘイ", language: "ja-JP" },
    { word: "オーケー", language: "ja-JP" },
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

## API

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
