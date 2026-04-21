import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PulsePairs",
    short_name: "PulsePairs",
    description: "PulsePairs",
    start_url: "/",
    display: "standalone",
    // PWA splash background + theme match the Phase 1 dark palette.
    // Values are the sRGB approximations of --bg-0 / --fg-0 from
    // src/app/design-tokens.css (oklch manifest values aren't widely supported).
    background_color: "#0a0e12",
    theme_color: "#0a0e12",
  };
}
