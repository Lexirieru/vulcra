// Shared E2E helpers: page-error / hydration-mismatch collection and the XRPL
// wallet localStorage injection the wallet-gated flows rely on.
import { expect, type BrowserContext, type Page } from "@playwright/test";

/** localStorage key the app hydrates the XRPL connection from (see
 * src/hooks/useXrplWallet.ts). Value is JSON {providerId, address}. */
export const XRPL_WALLET_KEY = "vulcra:xrpl-wallet";

/** A syntactically valid classic r-address used as a placeholder. It is NOT
 * expected to own a PersonalAccount/vault on Coston2, so flows keyed on it must
 * degrade gracefully (no banner) rather than break. */
export const PLACEHOLDER_R_ADDRESS = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";

/** All 13 first-class routes of the dApp (static + both dynamic-branch keys). */
export const ROUTES = [
  "/",
  "/borrow",
  "/borrow/xrp",
  "/borrow/fxrp",
  "/borrow/wflr",
  "/earn",
  "/earn/fxrp",
  "/earn/wflr",
  "/guardian",
  "/incentives",
  "/liquidations",
  "/redeem",
  "/xrpl",
] as const;

// Substrings that mark a React/Next hydration mismatch. Any of these appearing
// on `console` or in a thrown error fails the page.
const HYDRATION_SIGNATURES = [
  "Hydration failed",
  "did not match",
  "Text content does not match",
  "server rendered HTML",
  "hydrating",
  "Minified React error #418",
  "Minified React error #423",
  "Minified React error #425",
];

// Console-error noise that is NOT a frontend defect: RPC/indexer/wallet calls
// that legitimately fail in a headless env with no injected EVM wallet and a
// possibly-offline backend. These must not fail a route smoke test.
const BENIGN_CONSOLE = [
  "Failed to load resource",
  "net::ERR_",
  "ERR_CONNECTION",
  "429",
  "500",
  "the server responded with a status",
  "WalletConnect",
  "Reown",
  "wagmi",
  "chrome-extension",
  "Content Security Policy",
  "Download the React DevTools",
];

export interface PageProbe {
  /** Uncaught exceptions thrown on the page. */
  readonly pageErrors: string[];
  /** Console messages that look like a hydration mismatch. */
  readonly hydrationErrors: string[];
}

/** Attach listeners that record uncaught page errors and hydration-mismatch
 * console output. Call BEFORE navigating. */
export function attachPageProbe(page: Page): PageProbe {
  const pageErrors: string[] = [];
  const hydrationErrors: string[] = [];

  page.on("pageerror", (err) => {
    const text = err.message || String(err);
    pageErrors.push(text);
    if (HYDRATION_SIGNATURES.some((s) => text.includes(s))) hydrationErrors.push(text);
  });

  page.on("console", (msg) => {
    if (msg.type() !== "error" && msg.type() !== "warning") return;
    const text = msg.text();
    if (HYDRATION_SIGNATURES.some((s) => text.includes(s))) hydrationErrors.push(text);
  });

  return { pageErrors, hydrationErrors };
}

/** Assert a page raised no genuine defect: no uncaught exception (minus benign
 * network/wallet noise) and no hydration mismatch. */
export function expectNoPageDefects(probe: PageProbe): void {
  const realErrors = probe.pageErrors.filter(
    (e) => !BENIGN_CONSOLE.some((b) => e.includes(b)),
  );
  expect(realErrors, `uncaught page errors:\n${realErrors.join("\n")}`).toEqual([]);
  expect(
    probe.hydrationErrors,
    `hydration mismatches:\n${probe.hydrationErrors.join("\n")}`,
  ).toEqual([]);
}

/** Inject the XRPL wallet connection into localStorage for every navigation on
 * this context, BEFORE app scripts run. useXrplWallet() rehydrates from it on
 * mount, so the dApp comes up already "connected" to `address` — no extension.
 *
 * This is the ONLY wallet state we can forge: the XRPL side is a plain
 * (providerId, address) pair in localStorage. The EVM side (Reown/wagmi) keeps
 * its session in WalletConnect/IndexedDB behind a signing handshake and can't
 * be injected this way — see README "Known limitations". */
export async function injectXrplWallet(
  context: BrowserContext,
  address = PLACEHOLDER_R_ADDRESS,
  providerId: "crossmark" | "gemwallet" = "crossmark",
): Promise<void> {
  await context.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* storage unavailable — non-fatal, mirrors the app */
      }
    },
    [XRPL_WALLET_KEY, JSON.stringify({ providerId, address })] as const,
  );
}

/** Wait until the AppShell has mounted — the "Primary" nav is present on every
 * route, so it is a stable "the shell rendered" signal. */
export async function waitForShell(page: Page): Promise<void> {
  await expect(page.getByRole("navigation", { name: "Primary" }).first()).toBeVisible();
}
