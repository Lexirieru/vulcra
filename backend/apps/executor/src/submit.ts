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

export async function submitDirectMinting(
  deps: SubmitDeps,
  args: { proof: unknown; userOpBytes: Hex },
): Promise<Hex> {
  const abi = await loadAssetManagerAbi();
  const account = deps.walletClient.account;
  if (!account) throw new Error("wallet client has no account (EXECUTOR_PRIVATE_KEY missing)");

  const { request } = await deps.publicClient.simulateContract({
    address: deps.assetManager,
    abi: abi as never,
    functionName: "executeDirectMintingWithData",
    args: [args.proof, args.userOpBytes],
    account,
    value: 0n, // A-BE3
  });
  return deps.walletClient.writeContract(request as never);
}
