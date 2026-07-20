// XRPL browser-wallet abstraction for injected, MetaMask-style extensions:
// Crossmark and GemWallet. Both connect + sign in-browser with NO server API key.
// The SDKs are dynamically imported inside each method so this module is SSR-safe.
//
// The backend builds the exact XRPL Payment (destination, drops, 0xFE memo). We
// submit a RAW Payment tx JSON — GemWallet.submitTransaction / Crossmark
// .signAndSubmitAndWait — so the 0xFE MemoData bytes are preserved verbatim
// (never re-encoded). No destination tag is ever added (it would reroute the mint).

export type XrplProviderId = "crossmark" | "gemwallet";

export interface XrplPaymentInput {
  destination: string;
  /** Amount in drops (string), as returned by the backend. */
  amountDrops: string;
  /** 0xFE memo, hex (with or without 0x). */
  memoHex: string;
}

export interface XrplProvider {
  id: XrplProviderId;
  name: string;
  installUrl: string;
  isInstalled(): Promise<boolean>;
  connect(): Promise<string>; // classic r-address
  signPayment(account: string, p: XrplPaymentInput): Promise<string>; // xrpl tx hash
}

const R_ADDR = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const TX_HASH = /^[0-9A-Fa-f]{64}$/;

// Robust extraction that survives SDK response-shape differences.
function deepFindString(value: unknown, matcher: RegExp, depth = 0): string | undefined {
  if (depth > 6 || value == null) return undefined;
  if (typeof value === "string") return matcher.test(value) ? value : undefined;
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = deepFindString(v, matcher, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const found = deepFindString(v, matcher, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function buildPaymentTx(account: string, p: XrplPaymentInput) {
  return {
    TransactionType: "Payment",
    Account: account,
    Destination: p.destination,
    Amount: p.amountDrops,
    Memos: [{ Memo: { MemoData: p.memoHex.replace(/^0x/, "").toUpperCase() } }],
    // Intentionally NO DestinationTag — a tag reroutes the direct mint.
  };
}

export const gemWallet: XrplProvider = {
  id: "gemwallet",
  name: "GemWallet",
  installUrl: "https://gemwallet.app",
  async isInstalled() {
    try {
      const { isInstalled } = await import("@gemwallet/api");
      const r = (await isInstalled()) as { result?: { isInstalled?: boolean } };
      return Boolean(r?.result?.isInstalled);
    } catch {
      return false;
    }
  },
  async connect() {
    const { getAddress } = await import("@gemwallet/api");
    const r = await getAddress();
    const addr = deepFindString(r, R_ADDR);
    if (!addr) throw new Error("GemWallet did not return an address (is it unlocked?).");
    return addr;
  },
  async signPayment(account, p) {
    const { submitTransaction } = await import("@gemwallet/api");
    const r = await submitTransaction({
      // GemWallet signs + submits the raw tx as-is, preserving the memo bytes.
      transaction: buildPaymentTx(account, p) as never,
    });
    const hash = deepFindString(r, TX_HASH);
    if (!hash) throw new Error("GemWallet payment was rejected or returned no hash.");
    return hash;
  },
};

type CrossmarkSdk = {
  methods: {
    isInstalled: () => boolean;
    signInAndWait: () => Promise<unknown>;
    signAndSubmitAndWait: (tx: unknown) => Promise<unknown>;
  };
};

async function loadCrossmark(): Promise<CrossmarkSdk> {
  const mod = (await import("@crossmarkio/sdk")) as unknown as {
    default?: CrossmarkSdk;
  } & CrossmarkSdk;
  return (mod.default ?? mod) as CrossmarkSdk;
}

export const crossmark: XrplProvider = {
  id: "crossmark",
  name: "Crossmark",
  installUrl: "https://crossmark.io",
  async isInstalled() {
    try {
      const sdk = await loadCrossmark();
      return Boolean(sdk.methods.isInstalled());
    } catch {
      return false;
    }
  },
  async connect() {
    const sdk = await loadCrossmark();
    const r = await sdk.methods.signInAndWait();
    const addr = deepFindString(r, R_ADDR);
    if (!addr) throw new Error("Crossmark did not return an address (sign-in declined?).");
    return addr;
  },
  async signPayment(account, p) {
    const sdk = await loadCrossmark();
    const r = await sdk.methods.signAndSubmitAndWait(buildPaymentTx(account, p));
    const hash = deepFindString(r, TX_HASH);
    if (!hash) throw new Error("Crossmark payment was rejected or returned no hash.");
    return hash;
  },
};

export const XRPL_PROVIDERS: Record<XrplProviderId, XrplProvider> = {
  crossmark,
  gemwallet: gemWallet,
};

export const XRPL_PROVIDER_ORDER: XrplProviderId[] = ["crossmark", "gemwallet"];
