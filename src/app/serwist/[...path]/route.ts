import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";
import type { NextRequest } from "next/server";

const revision =
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout ??
  crypto.randomUUID();

const serwistRoute = createSerwistRoute({
  additionalPrecacheEntries: [{ url: "/~offline", revision }],
  swSrc: "app/sw.ts",
  nextConfig: {},
});

export const dynamic = "force-static";
export const dynamicParams = false;
export const revalidate = false;

export const GET = (
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) => {
  return serwistRoute.GET(request, context as never);
};
