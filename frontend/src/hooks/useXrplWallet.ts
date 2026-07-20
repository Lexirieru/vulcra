"use client";

// Connect + sign with an injected XRPL browser wallet (Crossmark / GemWallet).
// No server API key. Holds the connected r-address and exposes signPayment for
// the backend-built Payment (0xFE memo preserved).
import { useState } from "react";
import {
  XRPL_PROVIDERS,
  type XrplPaymentInput,
  type XrplProviderId,
} from "@/lib/xrpl/wallets";

export function useXrplWallet() {
  const [providerId, setProviderId] = useState<XrplProviderId | undefined>();
  const [address, setAddress] = useState<string | undefined>();
  const [connecting, setConnecting] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function connect(id: XrplProviderId): Promise<string | undefined> {
    setConnecting(true);
    setError(undefined);
    try {
      const p = XRPL_PROVIDERS[id];
      if (!(await p.isInstalled())) {
        throw new Error(`${p.name} not detected — install the extension and reload.`);
      }
      const addr = await p.connect();
      setProviderId(id);
      setAddress(addr);
      return addr;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect XRPL wallet");
      return undefined;
    } finally {
      setConnecting(false);
    }
  }

  async function signPayment(p: XrplPaymentInput): Promise<string | undefined> {
    if (!providerId || !address) {
      setError("No XRPL wallet connected");
      return undefined;
    }
    setSigning(true);
    setError(undefined);
    try {
      return await XRPL_PROVIDERS[providerId].signPayment(address, p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signing failed");
      return undefined;
    } finally {
      setSigning(false);
    }
  }

  function disconnect() {
    setProviderId(undefined);
    setAddress(undefined);
    setError(undefined);
  }

  return { providerId, address, connecting, signing, error, connect, signPayment, disconnect };
}
