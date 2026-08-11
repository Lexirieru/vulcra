import type { Address, Hex, PublicClient, WalletClient } from "viem";

/**
 * Submit executeDirectMintingWithData(proof, userOpBytes) on AssetManagerFXRP.
 *
 * LIVE + GATED. The IXRPPayment.Proof tuple is large and version-specific, so
 * the typed AssetManager ABI is loaded from
 * @flarenetwork/flare-wagmi-periphery-package at runtime rather than
 * hand-written (which would risk a proof-tuple drift => every mint reverts).
 * Install that package to enable live submits; nothing here is mocked.
 *
 * msg.value = 0: the Zap calls are ERC-20 only (A-BE3), so the executor pays
 * only gas.
 */
export interface SubmitDeps {
  publicClient: PublicClient;
  walletClient: WalletClient;
  assetManager: Address;
}

// Optional peer specifier held in a variable so the type-checker does not try to
// resolve it at build time (it is installed only when live submits are enabled).
const PERIPHERY_PKG = "@flarenetwork/flare-wagmi-periphery-package";

async function loadAssetManagerAbi(): Promise<readonly unknown[]> {
  try {
    // Optional peer: install the periphery package for the exact Coston2
    // AssetManager ABI (incl. the IXRPPayment.Proof tuple).
    const mod: Record<string, unknown> = await import(PERIPHERY_PKG);
    const coston2 = (mod.coston2 ?? mod.default) as Record<string, unknown> | undefined;
    const abi = coston2?.["assetManagerAbi"] ?? coston2?.["iAssetManagerAbi"];
    if (!abi) throw new Error("periphery package present but AssetManager ABI export not found");
    return abi as readonly unknown[];
  } catch (err) {
    throw new Error(
      "Live mint submit is gated: install @flarenetwork/flare-wagmi-periphery-package to obtain the " +
        "typed AssetManager ABI (executeDirectMintingWithData + IXRPPayment.Proof). " +
        `Underlying: ${(err as Error).message}`,
    );
  }
}

/**
 * Retry-on-revert window for the on-chain simulate. The `executeDirectMintingWithData`
 * call can revert TRANSIENTLY right after proof retrieval: the DA layer serves the
 * proof a little before the on-chain state that verifies/executes it has fully
 * settled, so a same-instant simulate reverts even though the identical calldata
 * succeeds a few minutes later (verified by forked replay: the exact reverting
 * tx executes cleanly against slightly-later state). Rather than dropping straight
 * to 0xE0 recovery, poll the simulate until it passes.
 */
const SUBMIT_RETRIES = 12;
const SUBMIT_RETRY_DELAY_MS = 30_000;

export async function submitDirectMinting(
  deps: SubmitDeps,
  args: { proof: unknown; userOpBytes: Hex },
): Promise<Hex> {
  const abi = await loadAssetManagerAbi();
  const account = deps.walletClient.account;
  if (!account) throw new Error("wallet client has no account (EXECUTOR_PRIVATE_KEY missing)");

  let lastErr: unknown;
  for (let attempt = 0; attempt < SUBMIT_RETRIES; attempt++) {
    try {
      const { request } = await deps.publicClient.simulateContract({
        address: deps.assetManager,
        abi: abi as never,
        functionName: "executeDirectMintingWithData",
        args: [args.proof, args.userOpBytes],
        account,
        value: 0n, // A-BE3
      });
      // Simulate passed → the tx is valid against current state; send it.
      return deps.walletClient.writeContract(request as never);
    } catch (err) {
      lastErr = err;
      if (attempt < SUBMIT_RETRIES - 1) {
        console.log(
          `[submit] executeDirectMintingWithData simulate reverted (try ${attempt + 1}/${SUBMIT_RETRIES}); ` +
            `state may not have settled yet — retrying in ${SUBMIT_RETRY_DELAY_MS / 1000}s`,
        );
        await new Promise((r) => setTimeout(r, SUBMIT_RETRY_DELAY_MS));
      }
    }
  }
  throw lastErr;
}
