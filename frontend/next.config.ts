import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Reown AppKit / WalletConnect pull optional pino transports and legacy
  // deps that must not be bundled for the browser build (KTD1 / U1).
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
