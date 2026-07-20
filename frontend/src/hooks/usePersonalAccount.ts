"use client";

// XRPL personal-account lookup (U8). Backend resolves the derived PersonalAccount
// + FXRP balance for an r-address (GET /account/:xrplAddress). Validation of the
// r-address happens before the query fires.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";

// Classic XRPL address: base58 (no 0OIl), starts with 'r', 25–35 chars.
const R_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

export function isValidRAddress(value: string): boolean {
  return R_ADDRESS_RE.test(value.trim());
}

export function usePersonalAccount(rAddress: string) {
  const enabled = isValidRAddress(rAddress);
  const query = useQuery({
    queryKey: ["account", rAddress],
    queryFn: () => api.getAccount(rAddress.trim()),
    enabled,
    retry: 1,
    staleTime: 15_000,
  });

  return { ...query, enabled };
}
