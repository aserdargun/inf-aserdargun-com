import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  agentRules: false,
  // Production SWA owns the equivalent rewrite. This development-only mirror lets
  // browser tests exercise static viewer shells at real deep-link URLs.
  ...(process.env.NODE_ENV === "development" ? {
    async rewrites() { return [{ source: "/infographic/:path*", destination: "/infographic/" }, { source: "/view/:path*", destination: "/view/" }]; },
  } : {}),
};

export default config;
