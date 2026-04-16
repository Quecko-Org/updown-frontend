import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PulsePairs",
    short_name: "PulsePairs",
    description: "PulsePairs",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#7132f5",
  };
}
