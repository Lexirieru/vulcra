import type { Address, PublicClient } from "viem";
import {
  assetManagerAbi,
  resolveAssetManagerFXRP,
  resolveMasterAccountController,
} from "@vulcra/chain-client";
import { vaultManagerAbi } from "@vulcra/interfaces";
import { getPersonalAccount, getNonce } from "@vulcra/userop";
import { preflightMint } from "./preflight/preflight.js";
import { buildMintPlan } from "./mintBuilder.js";
import { buildManagePlan } from "./manageBuilder.js";
import type { ExecutorServices } from "./server.js";
import type { ExecutorEnv } from "./env.js";
import type { MintStore } from "./orchestrator/store.js";

/**
 * Live executor services (R11/R12) — reads direct-minting settings + protocol
 * params from Coston2 at runtime (nothing hardcoded). Gated: requires the
 * VaultManager address. Not mocked.
 *
 * NOTE: the raw hourly/daily limiter-STATE getters (consumed/windowStart) have
 * an ABI shape to verify at integration; until then this reads the limit CAPS
 * and treats the current window as empty (optimistic). The large-mint delay and
 * min-fee/min-debt/address blocks are exact. Real rate-limit delays are always
 * handled at execution time by the same-proof retry (AE1), so an optimistic
 * pre-flight never causes a lost payment.
 */
export async function buildLiveServices(
  client: PublicClient,
  env: ExecutorEnv,
  store: MintStore,
): Promise<ExecutorServices> {
  const vaultManager = env.vaultManagerAddress as Address;

  const readAm = async () => {
    const assetManager = await resolveAssetManagerFXRP(client);
    const read = (functionName: string) =>
      client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: functionName as never, args: [] }) as Promise<bigint>;
    const [minFeeUBA, mintFeeBips, executorFeeUBA, hourlyLimit, dailyLimit, largeThreshold, largeDelaySeconds, unblockUntil] =
      await Promise.all([
        read("getDirectMintingMinimumFeeUBA"),
        read("getDirectMintingFeeBIPS"),
        read("getDirectMintingExecutorFeeUBA"),
        read("getDirectMintingHourlyLimitUBA"),
        read("getDirectMintingDailyLimitUBA"),
        read("getDirectMintingLargeMintingThresholdUBA"),
        read("getDirectMintingLargeMintingDelaySeconds"),
        read("getDirectMintingsUnblockUntilTimestamp"),
      ]);
    return { minFeeUBA, mintFeeBips, executorFeeUBA, hourlyLimit, dailyLimit, largeThreshold, largeDelaySeconds, unblockUntil };
  };

  return {
    store,

    async preflight(input) {
      const [am, paramsResult, block] = await Promise.all([
        readAm(),
        // VaultManager exposes the config as a single `params()` struct getter
        // (mcrBps, minDebt18, mintFeeBps, liqBonusBps, redemptionFeeBps), not
        // individual getters. Read the struct and take minDebt18 (index 1).
        client.readContract({
          address: vaultManager,
          abi: [
            {
              type: "function",
              name: "params",
              stateMutability: "view",
              inputs: [],
              outputs: [
                { name: "mcrBps", type: "uint256" },
                { name: "minDebt18", type: "uint256" },
                { name: "mintFeeBps", type: "uint256" },
                { name: "liqBonusBps", type: "uint256" },
                { name: "redemptionFeeBps", type: "uint256" },
              ],
            },
          ],
          functionName: "params",
          args: [],
        }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint]>,
        client.getBlock(),
      ]);
      const minDebt18 = paramsResult[1];
      const now = block.timestamp;
      return preflightMint({
        xrplAddress: input.xrplAddress,
        netMintDrops: input.netMintDrops,
        mint18: input.mint18,
        minFeeUBA: am.minFeeUBA,
        mintFeeBips: am.mintFeeBips,
        executorFeeUBA: am.executorFeeUBA,
        hourly: { limit: am.hourlyLimit, consumed: 0n, windowStart: now },
        daily: { limit: am.dailyLimit, consumed: 0n, windowStart: now },
        largeThreshold: am.largeThreshold,
        largeDelaySeconds: am.largeDelaySeconds,
        unblockUntil: am.unblockUntil,
        minDebt18,
        nowSeconds: now,
      });
    },

    async account(xrplAddress) {
      const mac = await resolveMasterAccountController(client);
      const personalAccount = await getPersonalAccount(client as never, mac, xrplAddress);
      const nonce = await getNonce(client as never, mac, personalAccount);
      return { personalAccount, nonce };
    },

    buildMint(input) {
      return buildMintPlan(client, env, input);
    },

    buildManage(input) {
      return buildManagePlan(client, env, input);
    },
  };
}
