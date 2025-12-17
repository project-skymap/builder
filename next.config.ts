import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@project-skymap/library"],
  experimental: {
    externalDir: true
  }
};

export default nextConfig;
