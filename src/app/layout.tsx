import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { ClientProviders } from "./ClientProviders";

// Geist + Geist Mono are loaded via the @import in design-tokens.css (Google
// Fonts CDN). Self-hosted Bebas Neue + Lemon Milk are declared via @font-face
// in the same file. No Next/font loader needed for Phase 1.

const APP_DESCRIPTION =
  "Trade fast BTC and ETH UP/DOWN markets on PulsePairs — pick a direction, " +
  "set your price, and settle on-chain when the round closes.";
const APP_OG_TITLE = "PulsePairs — fast BTC & ETH UP/DOWN markets";

export const metadata: Metadata = {
  title: "PulsePairs",
  description: APP_DESCRIPTION,
  applicationName: "PulsePairs",
  // og:image intentionally omitted — public/ holds only SVG marks, which
  // social scrapers (Slack/X/Facebook) don't render as OG images. Add a
  // 1200×630 PNG to public/ and wire it here when one exists.
  openGraph: {
    type: "website",
    siteName: "PulsePairs",
    title: APP_OG_TITLE,
    description: APP_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: APP_OG_TITLE,
    description: APP_DESCRIPTION,
  },
  icons: {
    icon: [
      { url: "/logo/pulsepairs-mark.svg", type: "image/svg+xml" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ClientProviders>
          <AppShell>{children}</AppShell>
        </ClientProviders>
      </body>
    </html>
  );
}
