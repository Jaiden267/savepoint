import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone build for the Docker/ZimaOS deployment target.
  output: "standalone",
  images: {
    // IGDB artwork is the primary source of colour in the UI. Only IGDB's
    // image CDN is allowed; no arbitrary remote hosts.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.igdb.com",
        pathname: "/igdb/image/upload/**",
      },
    ],
  },
};

export default nextConfig;
