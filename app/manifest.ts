import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Yuyu Event Management",
    short_name: "Yuyu",
    description: "Create, manage, register for, and check in to free community events.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#0A84FF",
    icons: [
      { src: "/icons/yuyu-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/yuyu-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/yuyu-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
