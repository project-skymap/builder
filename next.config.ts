import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === 'production';
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'project-skymap';

const nextConfig: NextConfig = {
  output: 'export',
  // GitHub Pages serves from /<repo-name>/ subdirectory
  basePath: isProd ? `/${repoName}` : '',
  assetPrefix: isProd ? `/${repoName}/` : '',
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@project-skymap/library"],
  experimental: {
    externalDir: true
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: isProd ? `/${repoName}` : '',
  },
};

export default nextConfig;
