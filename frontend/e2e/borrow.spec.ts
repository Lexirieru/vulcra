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

    await page.getByLabel("FXRP to deposit").fill("100");

    // Max mint is derived from the live FTSO price, so this asserts the whole
    // collateral→price→maxMintable chain. Requires the dev server to reach
    // Coston2 RPC; generous timeout for the first price read.
    await expect(page.getByRole("button", { name: /^Max\s/ })).toBeVisible({ timeout: 20_000 });
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

    // Radiogroup selector — pick wFLR; URL must NOT change (state, not routing).
    await page.getByRole("radio", { name: /WC2FLR/i }).click();
    await expect(page).toHaveURL(/\/borrow\/fxrp$/);
    await expect(page.getByLabel("WC2FLR to deposit")).toBeVisible();
  });
});
