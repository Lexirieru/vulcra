import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { coston2 } from "./coston2.js";

/**
 * Coston2 transport tried in order: an explicit override (COSTON2_RPC_URL), then
 * thirdweb's public endpoint (faster + more concurrency-tolerant than Flare's
 * shared RPC under load — benchmarked ~0.9s vs ~1.4s for 25 parallel reads), then
 * the Flare public RPC as the always-available fallback. viem's `fallback` retries
 * the next URL on error, so a momentary drop on any single provider can't strand a
 * read or a submit.
 */
function coston2Transport(rpcUrl?: string) {
  const urls = [
    rpcUrl,
    "https://flare-testnet-coston2.rpc.thirdweb.com",
    coston2.rpcUrls.default.http[0],
  ].filter((u): u is string => Boolean(u));
  const unique = [...new Set(urls)];
  return fallback(unique.map((u) => http(u)));
}

/** Read-only client. Safe to construct without any key. */
export function makePublicClient(rpcUrl?: string): PublicClient {
  return createPublicClient({
    chain: coston2,
    transport: coston2Transport(rpcUrl),
  }) as PublicClient;
}

/**
 * Signing client for the executor EOA. GATED: requires EXECUTOR_PRIVATE_KEY.
 * Throws a clear error if the key is missing so live steps fail fast at boot
 * rather than mid-mint. Never mock this — real mint needs a funded key.
 */
export function makeWalletClient(privateKey?: string, rpcUrl?: string): WalletClient {
  if (!privateKey) {
    throw new Error(
      "EXECUTOR_PRIVATE_KEY is not set — a funded Coston2 key is required to submit on-chain mints. " +
        "Set it in .env (gitignored) to enable live execution.",
    );
  }
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return createWalletClient({
    account,
    chain: coston2,
    transport: coston2Transport(rpcUrl),
  });
}
