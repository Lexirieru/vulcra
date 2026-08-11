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
 * Retry window for the direct-minting submit. `executeDirectMintingWithData` can
 * fail TRANSIENTLY right after proof retrieval — and crucially, the eth_call
 * `simulateContract` frequently PASSES while the tx that follows a block or two
 * later REVERTS on-chain (verified: the exact reverting calldata replays cleanly
 * against slightly-later state on a fork). So we must retry on the on-chain
 * REVERT (the mined receipt), not only on a simulate revert. Each attempt
 * re-simulates and re-sends; a reverted tx rolls its state back (incl. the FDC
 * usedTransactionIds flag), so the same proof + userOp is safe to resubmit.
 * Only after the full window fails do we fall through to 0xE0 recovery.
 */
const SUBMIT_RETRIES = 20;
const SUBMIT_RETRY_DELAY_MS = 20_000;

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
      const hash = await deps.walletClient.writeContract(request as never);
      const receipt = await deps.publicClient.waitForTransactionReceipt({ hash });
      // A successful receipt (incl. a DirectMintingDelayed one — that is not a
      // revert) is the outcome the caller inspects. A reverted receipt is the
      // transient race: retry.
      if (receipt.status === "success") return hash;
      lastErr = new Error(`executeDirectMintingWithData tx ${hash} reverted on-chain`);
    } catch (err) {
      lastErr = err; // simulate revert / send error — also transient here
    }
    if (attempt < SUBMIT_RETRIES - 1) {
      console.log(
        `[submit] executeDirectMintingWithData not yet valid (try ${attempt + 1}/${SUBMIT_RETRIES}); ` +
          `state likely not settled — retrying in ${SUBMIT_RETRY_DELAY_MS / 1000}s`,
      );
      await new Promise((r) => setTimeout(r, SUBMIT_RETRY_DELAY_MS));
    }
  }
  throw lastErr;
}
