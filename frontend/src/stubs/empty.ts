// Empty stub for optional Coinbase Base-Account / x402 modules that the wagmi
// connector pulls transitively via Reown AppKit. Vulcra never uses the Base
// Account / x402 / Solana signing paths, and these optional sub-packages are not
// installed, so we alias them here (turbopack.resolveAlias) to satisfy the module
// graph. The dynamic imports that reference them are never executed at runtime.
export {};
