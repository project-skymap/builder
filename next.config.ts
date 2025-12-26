import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@project-skymap/library"],
  experimental: {
    externalDir: true
  }
};

export default nextConfig;
