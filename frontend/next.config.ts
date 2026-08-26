import type { NextConfig } from "next";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: API_URL + "/api/:path*",
      },
      // Eski alohida HTML sahifalar yagona dashboard'ga yo'naltiriladi
      { source: "/davomat.html", destination: "/attendance" },
      { source: "/hujjatlar.html", destination: "/hujjatlar" },
      { source: "/director.html", destination: "/xodim-nazorati" },
    ];
  },
};

export default nextConfig;
