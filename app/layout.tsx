import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Infographics",
  applicationName: "Infographics",
  description: "Personal infographic learning system",
  // Icons are listed in smallest-first order so a single 32x32 PNG leads the
  // browser; SVG is the long-term icon for high-DPI displays. The maskable
  // PWA icon stays in the manifest only.
  icons: [
    { rel: "icon", type: "image/svg+xml", url: "/favicon.svg" },
    { rel: "alternate icon", type: "image/png", sizes: "32x32", url: "/icons/favicon-32.png" },
    { rel: "apple-touch-icon", sizes: "180x180", url: "/icons/apple-touch-icon.png" },
  ],
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Render-blocking theme bootstrap is moved to a deferred, preloaded
            script so the first paint is not gated on /theme-bootstrap.js. */}
        <link rel="preload" as="script" href="/theme-bootstrap.js" />
        <link rel="preload" as="image" href="/favicon.svg" type="image/svg+xml" />
        <script async src="/theme-bootstrap.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}
