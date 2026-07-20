import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { coston2 } from "./coston2.js";

/** Read-only client. Safe to construct without any key. */
export function makePublicClient(rpcUrl?: string): PublicClient {
  return createPublicClient({
    chain: coston2,
    transport: http(rpcUrl ?? coston2.rpcUrls.default.http[0]),
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
    transport: http(rpcUrl ?? coston2.rpcUrls.default.http[0]),
  });
}
