import type { NextConfig } from "next";
import path from "node:path";

// Reown AppKit's wagmi adapter transitively pulls Coinbase Base-Account / x402
// optional sub-packages (the whole `@x402/*` scope) that are not installed and
// that Vulcra never uses. Both bundlers need them neutralized so the build
// resolves cleanly (U1):
//   • production build runs webpack (`next build --webpack`) → IgnorePlugin the scope
//   • dev runs Turbopack → alias the known subpaths to an empty stub module
const STUB = path.resolve(__dirname, "src/stubs/empty.ts");
const OPTIONAL_X402 = [
  "@x402/core/client",
  "@x402/svm/exact/client",
  "@x402/evm/exact/client",
  "@x402/evm/upto/client",
  "@x402/svm/exact",
  "@x402/evm",
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    resolveAlias: Object.fromEntries(OPTIONAL_X402.map((m) => [m, STUB])),
  },
  webpack: (config, { webpack }) => {
    config.plugins = config.plugins ?? [];
    // Neutralize optional connector deps pulled by the @wagmi/connectors barrel
    // that Vulcra never uses: Coinbase x402 scope, the `tempo` connector's bare
    // `accounts` import, Porto, the MetaMask SDK connector, and the wagmi-native
    // WalletConnect connector's ethereum-provider (AppKit ships its own
    // @walletconnect/universal-provider, so its WalletConnect flow is unaffected).
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp:
          /^(@x402(\/|$)|accounts$|porto(\/|$)|@metamask\/connect-evm$|@walletconnect\/ethereum-provider$)/,
      }),
    );
    config.externals = config.externals ?? [];
    if (Array.isArray(config.externals)) {
      config.externals.push("pino-pretty", "lokijs", "encoding");
    }
    return config;
  },
};

export default nextConfig;
