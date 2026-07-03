import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["esbuild-wasm"],
  // NOTE: Vosk モデルは Cloudflare R2 (models.use-ear.kkweb.io) から配信し、
  // 長期 immutable キャッシュは R2 側の Cloudflare ルールで付与している。
  // かつてここにあった /models/* の Cache-Control ヘッダは同一オリジン配信を
  // やめたため不要になり削除した。
};

export default nextConfig;
