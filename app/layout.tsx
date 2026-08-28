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

export const viewport: Viewport = {
  themeColor: "#ffffff",
  // Match the physical viewport so the layout engine uses real CSS pixels on
  // mobile browsers. Without `width: "device-width"`, legacy handsets would
  // assume a 980px canvas and down-scale the page, breaking the mobile
  // bottom-nav and topbar placement.
  width: "device-width",
  initialScale: 1,
  // `viewportFit: "cover"` lets the layout extend behind the iPhone notch and
  // the home indicator; the safe-area insets are already honored by the
  // mobile-nav padding-bottom and the app-main bottom padding.
  viewportFit: "cover",
};

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
