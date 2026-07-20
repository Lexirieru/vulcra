import { getAddress, type Address, type PublicClient } from "viem";
import { flareContractRegistryAbi, assetManagerAbi } from "./abis.js";
import { FLARE_CONTRACT_REGISTRY, RegistryNames } from "./coston2.js";

const ZERO = "0x0000000000000000000000000000000000000000";

/** Resolve any Flare system contract by its registry name (R8 — nothing hardcoded). */
export async function resolveContract(
  client: PublicClient,
  name: string,
): Promise<Address> {
  const addr = (await client.readContract({
    address: FLARE_CONTRACT_REGISTRY,
    abi: flareContractRegistryAbi,
    functionName: "getContractAddressByName",
    args: [name],
  })) as Address;
  if (!addr || addr.toLowerCase() === ZERO) {
    throw new Error(`FlareContractRegistry has no address for "${name}"`);
  }
  return getAddress(addr);
}

export function resolveAssetManagerFXRP(client: PublicClient): Promise<Address> {
  return resolveContract(client, RegistryNames.AssetManagerFXRP);
}

export function resolveFtsoV2(client: PublicClient): Promise<Address> {
  return resolveContract(client, RegistryNames.FtsoV2);
}

export function resolveMasterAccountController(client: PublicClient): Promise<Address> {
  return resolveContract(client, RegistryNames.MasterAccountController);
}

/** AssetManagerFXRP -> fAsset() gives the FXRP ERC-20 token address. */
export async function resolveFxrpToken(client: PublicClient): Promise<Address> {
  const assetManager = await resolveAssetManagerFXRP(client);
  const fxrp = (await client.readContract({
    address: assetManager,
    abi: assetManagerAbi,
    functionName: "fAsset",
    args: [],
  })) as Address;
  return getAddress(fxrp);
}
