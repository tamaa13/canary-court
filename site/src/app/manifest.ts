import type { MetadataRoute } from "next";

/** /manifest.webmanifest: the installable app's name and rt-3d's icons (the mark sits inside the maskable safe circle) */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Canary Court",
    short_name: "Canary Court",
    description: "Give AI money. Not the keys. An autonomous red-teaming market on NEAR testnet.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f5f1",
    theme_color: "#f6f5f1",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
