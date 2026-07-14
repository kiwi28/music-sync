import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output reduces Docker image size by excluding dev dependencies
  output: "standalone",

  // Remove the X-Powered-By header to avoid leaking framework info
  poweredByHeader: false,

  // Disable source maps in production to reduce bundle size and avoid
  // exposing source code to the browser
  productionBrowserSourceMaps: false,
};

export default nextConfig;
