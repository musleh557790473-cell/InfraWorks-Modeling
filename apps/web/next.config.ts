import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Allow API reverse-proxy on :8787 to fetch /_next in development
  allowedDevOrigins: ["127.0.0.1", "localhost", "0.0.0.0"],
};

export default nextConfig;
