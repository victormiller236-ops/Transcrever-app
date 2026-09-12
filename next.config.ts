import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/street-shift", destination: "/street-shift/index.html" },
    ];
  },
};

export default nextConfig;
