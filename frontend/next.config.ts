import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack 루트 디렉토리 명시적 지정 (Next.js 16+ 문법)
  experimental: {
    turbopack: {
      root: process.cwd(),
    },
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8000/api/:path*', // Proxy to Backend
      },
    ];
  },
};

export default nextConfig;
