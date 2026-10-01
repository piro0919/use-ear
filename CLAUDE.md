# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/claude-code) when working with code in this repository.

## Project Overview

use-ear is a React hooks library for wake word detection using the Web Speech API. It allows detecting customizable wake words from microphone input and executing callbacks when detected.

## Tech Stack

- React 18+
- TypeScript
- Next.js 16 (for demo/development)
- Biome (linting and formatting)
- Tailwind CSS 4

## Key Files

- `src/hooks/useEar.ts` - Main hooks implementation
- `src/types/index.ts` - TypeScript type definitions
- `src/index.ts` - Package entry point
- `src/app/page.tsx` - Demo page
- `tsconfig.build.json` - Build configuration for npm package

## Commands

```bash
npm run dev          # Start Next.js dev server
npm run build        # Build Next.js app
npm run build:lib    # Build library for npm (outputs to dist/)
npm run lint         # Run Biome linter
npm run format       # Format code with Biome
```

## Architecture

### Core Hook (`useEar`)

The hook provides:
- Wake word detection via Web Speech API
- Multi-language support with language rotation
- Mobile keep-alive using silent audio playback
- Automatic reconnection in continuous mode

### Key Concepts

1. **WakeWordInput**: Can be a simple string or object with `{ word, language }`
2. **Language Rotation**: When multiple languages are specified, the recognition engine cycles through them on each session end
3. **Keep-Alive**: Uses AudioContext with near-silent oscillator to maintain audio session on mobile

## Development Notes

- `dist` must start with `"use client"`. tsup's `banner` puts it there; `treeshake`
  is off because its pass drops the banner (and esbuild drops in-file directives).
  CI checks the first line of both builds.
- `peerDependencies.react` is `>=18`: the hooks use only `useState`, `useEffect`,
  `useRef` and `useCallback`. CI runs the tests on React 18 too. Do not let a
  Renovate range bump raise this floor.
- `pnpm check:package` runs publint and attw; `require` must resolve to
  `index.d.cts`.
- The Web Speech API errors `not-allowed`, `service-not-allowed` and
  `audio-capture` stop listening instead of restarting every 100 ms.
- The wake lock sentinel's `release` event clears `wakeLockRef`, so the
  `visibilitychange` handler can take it again after the browser auto-releases it.

- The library exports from `src/index.ts` and builds to `dist/`
- Demo app runs on Next.js but the library itself has no Next.js dependency
- Web Speech API types are defined locally in `useEar.ts` for cross-browser compatibility
