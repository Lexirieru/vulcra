// (e) Injecting the XRPL wallet localStorage for an r-address drives the
//     XrplVaultBanner path on /borrow/fxrp. With a placeholder r-address (no
//     PersonalAccount vault on Coston2) the banner must degrade gracefully —
//     i.e. NOT render — while the rest of the page stays intact.
//
// The banner only appears when: branch.hasXrplMint (FXRP) AND an XRP wallet is
// connected AND that wallet's PersonalAccount actually owns a vault the EVM view
// can't see. We can forge the first two via localStorage; the third depends on
// real on-chain/backend state, which a placeholder address does not have — so
// "no banner" is the correct, asserted outcome.
import { test, expect } from "@playwright/test";
import {
  PLACEHOLDER_R_ADDRESS,
  XRPL_WALLET_KEY,
  attachPageProbe,
  expectNoPageDefects,
  injectXrplWallet,
  waitForShell,
} from "./support";

// Text unique to the XrplVaultBanner.
const BANNER_TEXT = /You already have a .* vault/i;

test.describe("XRPL wallet injection", () => {
  test("localStorage injection hydrates the connection (key is present pre-load)", async ({
    context,
    page,
  }) => {
    await injectXrplWallet(context, PLACEHOLDER_R_ADDRESS);
    await page.goto("/borrow/fxrp", { waitUntil: "domcontentloaded" });
    await waitForShell(page);

    // The app rehydrates useXrplWallet() from this exact value on mount.
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), XRPL_WALLET_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!) as { providerId?: string; address?: string };
    expect(parsed.providerId).toBe("crossmark");
    expect(parsed.address).toBe(PLACEHOLDER_R_ADDRESS);
  });

  test("placeholder r-address with no vault → no banner, page still renders", async ({
    context,
    page,
  }) => {
    const probe = attachPageProbe(page);
    await injectXrplWallet(context, PLACEHOLDER_R_ADDRESS);
    await page.goto("/borrow/fxrp", { waitUntil: "domcontentloaded" });
    await waitForShell(page);

    // Let the PersonalAccount/vault lookups settle (they resolve to "no vault").
    await page.waitForLoadState("networkidle").catch(() => {});

    // Graceful degradation: the banner is absent.
    await expect(page.getByText(BANNER_TEXT)).toHaveCount(0);

    // ...and the borrow composer is unaffected — the page did not break.
    await expect(page.getByLabel("FXRP to deposit")).toBeVisible();

    expectNoPageDefects(probe);
  });

  test("no injected wallet → banner is absent (baseline)", async ({ page }) => {
    await page.goto("/borrow/fxrp", { waitUntil: "domcontentloaded" });
    await waitForShell(page);
    await expect(page.getByText(BANNER_TEXT)).toHaveCount(0);
  });

  test("injected wallet does not affect a non-XRPL branch (/borrow/wflr)", async ({
    context,
    page,
  }) => {
    // wFLR has no XRPL-native path (hasXrplMint = false), so the banner must
    // never show there even with an XRP wallet connected.
    await injectXrplWallet(context, PLACEHOLDER_R_ADDRESS);
    await page.goto("/borrow/wflr", { waitUntil: "domcontentloaded" });
    await waitForShell(page);
    await expect(page.getByText(BANNER_TEXT)).toHaveCount(0);
    await expect(page.getByLabel("WC2FLR to deposit")).toBeVisible();
  });
});
