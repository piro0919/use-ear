import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "useEar Demo",
    short_name: "useEar",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    theme_color: "#18181b",
    background_color: "#18181b",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
  };
}
