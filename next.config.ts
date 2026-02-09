import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: 'export',
  ...(basePath ? { basePath } : {}),
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@project-skymap/library"],
  experimental: {
    externalDir: true
  },
};

export default nextConfig;
