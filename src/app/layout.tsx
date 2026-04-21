import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { ClientProviders } from "./ClientProviders";

// Geist + Geist Mono are loaded via the @import in design-tokens.css (Google
// Fonts CDN). Self-hosted Bebas Neue + Lemon Milk are declared via @font-face
// in the same file. No Next/font loader needed for Phase 1.

export const metadata: Metadata = {
  title: "PulsePairs",
  description: "PulsePairs",
  applicationName: "PulsePairs",
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
