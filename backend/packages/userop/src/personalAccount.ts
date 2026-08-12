import type { Abi, Address } from "viem";

/**
 * MasterAccountController — minimal ABI for smart-account state reads.
 *
 * `getPersonalAccount`'s XRPL-address argument is `string` — verified against the
 * live MasterAccountController on Coston2 (and flare-smart-accounts @ fa301c5 /
 * flare-viem-starter). Deterministic — works before the personal account is deployed.
 */
export const masterAccountControllerAbi = [
  {
    type: "function",
    name: "getPersonalAccount",
    stateMutability: "view",
    inputs: [{ name: "xrplAddress", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getNonce",
    stateMutability: "view",
    inputs: [{ name: "personalAccount", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getExecutor",
    stateMutability: "view",
    inputs: [{ name: "personalAccount", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const satisfies Abi;

/** Minimal read surface we need from a viem PublicClient (keeps this package client-agnostic). */
export interface ContractReader {
  readContract(args: {
    address: Address;
    abi: typeof masterAccountControllerAbi;
    functionName: "getPersonalAccount" | "getNonce" | "getExecutor";
    args: readonly unknown[];
  }): Promise<unknown>;
}

export async function getPersonalAccount(
  client: ContractReader,
  masterAccountController: Address,
  xrplAddress: string,
): Promise<Address> {
  return (await client.readContract({
    address: masterAccountController,
    abi: masterAccountControllerAbi,
    functionName: "getPersonalAccount",
    args: [xrplAddress],
  })) as Address;
}

export async function getNonce(
  client: ContractReader,
  masterAccountController: Address,
  personalAccount: Address,
): Promise<bigint> {
  return (await client.readContract({
    address: masterAccountController,
    abi: masterAccountControllerAbi,
    functionName: "getNonce",
    args: [personalAccount],
  })) as bigint;
}

export async function getExecutor(
  client: ContractReader,
  masterAccountController: Address,
  personalAccount: Address,
): Promise<Address> {
  return (await client.readContract({
    address: masterAccountController,
    abi: masterAccountControllerAbi,
    functionName: "getExecutor",
    args: [personalAccount],
  })) as Address;
}
