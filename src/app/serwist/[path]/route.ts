import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

const revision =
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout ??
  crypto.randomUUID();

// @serwist/turbopack expects the route segment to be `[path]` (single segment),
// NOT `[...path]`. It also requires re-exporting `generateStaticParams` so that
// `dynamicParams = false` can prerender sw.js / sw.js.map at build time.
// (The previous `[...path]` + missing generateStaticParams caused /serwist/sw.js
// to 404, so the service worker never registered.)
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: [{ url: "/~offline", revision }],
    swSrc: "src/app/sw.ts",
    nextConfig: {},
  });
