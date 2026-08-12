// (d) /borrow/[collateral]: entering a collateral amount surfaces a "Max"
//     borrow value, and the primary CTA shows a dynamic not-ready reason (never
//     the "Open vault" ready state) while the loan is empty.
//
// NOTE on wallet gating: the FULL set of dynamic reasons ("Enter a loan
// amount", "Enter a collateral amount", "Not enough FXRP", "Adjust the loan
// amount") only renders once an EVM wallet is connected — and Reown/wagmi can't
// be injected headlessly (see README). Without a wallet the CTA is the
// wallet-gate ("Connect wallet to borrow"). Both are valid "not ready" states;
// the invariant we assert — and can assert deterministically — is that with an
// empty loan the CTA is NEVER "Open vault".
import { test, expect } from "@playwright/test";
import { attachPageProbe, expectNoPageDefects, waitForShell } from "./support";

test.describe("/borrow/fxrp composer", () => {
  test("renders the collateral → loan → interest composer", async ({ page }) => {
    const probe = attachPageProbe(page);
    await page.goto("/borrow/fxrp", { waitUntil: "domcontentloaded" });
    await waitForShell(page);

    await expect(
      page.getByRole("heading", { name: /Borrow vUSD against FXRP/i, level: 1 }),
    ).toBeVisible();

    // The three big number inputs.
    await expect(page.getByLabel("FXRP to deposit")).toBeVisible();
    await expect(page.getByLabel("vUSD to borrow")).toBeVisible();
    await expect(page.getByLabel("Annual interest rate in percent")).toBeVisible();

    expectNoPageDefects(probe);
  });

  test('entering collateral surfaces a "Max" borrow value', async ({ page }) => {
    await page.goto("/borrow/fxrp", { waitUntil: "domcontentloaded" });
    await waitForShell(page);

    // Wait for the live FTSO price to render (composer hydrated, oracle ready).
    await expect(page.getByText(/XRP\/USD price/i)).toBeVisible({ timeout: 45_000 });

    // The composer resets its transient inputs whenever its on-chain data settles
    // (can happen more than once under RPC load), which drops a fill issued during
    // a settle. Retry the fill AND the Max assertion together so the whole thing
    // re-runs until the value survives long enough for the live-price→maxMintable
    // Max button to render — the real oracle chain, no mock.
    const deposit = page.getByLabel("FXRP to deposit");
    await expect(async () => {
      await deposit.fill("100");
      await expect(page.getByRole("button", { name: /^Max\s/ })).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 40_000 });
  });

  test("CTA shows a not-ready reason (never 'Open vault') while the loan is empty", async ({
    page,
  }) => {
    await page.goto("/borrow/fxrp", { waitUntil: "domcontentloaded" });
    await waitForShell(page);

    await page.getByLabel("FXRP to deposit").fill("100");

    // Ready-state CTA must be absent while there is no loan amount.
    await expect(page.getByRole("button", { name: "Open vault" })).toHaveCount(0);

    // The reachable not-ready CTA. Without an injected EVM wallet this is the
    // wallet gate; with one it would be "Enter a loan amount". Either way the
    // union below matches and "Open vault" is excluded above.
    await expect(
      page.getByRole("button", {
        name: /Connect wallet to borrow|Enter a loan amount|Enter a collateral amount|Approve FXRP/,
      }),
    ).toBeVisible();
  });

  test("collateral selector switches the composed asset without navigating", async ({
    page,
  }) => {
    await page.goto("/borrow/fxrp", { waitUntil: "domcontentloaded" });
    await waitForShell(page);
    // Same hydration gate as above: interacting before the composer hydrates drops
    // the event. The live price is the readiness signal.
    await expect(page.getByText(/XRP\/USD price/i)).toBeVisible({ timeout: 45_000 });

    // Radiogroup selector — pick wFLR; URL must NOT change (state, not routing).
    // Retry the click until the switch takes: a click during the composer's initial
    // settle can be dropped (same window as the fill race above).
    await expect(async () => {
      await page.getByRole("radio", { name: /WC2FLR/i }).click();
      await expect(page.getByLabel("WC2FLR to deposit")).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 40_000 });
    await expect(page).toHaveURL(/\/borrow\/fxrp$/);
  });
});
