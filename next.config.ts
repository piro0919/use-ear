import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["esbuild-wasm"],
  // Vosk モデルはファイル名でバージョン管理されている不変アセットなので、
  // 長期 immutable キャッシュにして再訪問時の再検証(304往復)すら無くす。
  async headers() {
    return [
      {
        source: "/models/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
