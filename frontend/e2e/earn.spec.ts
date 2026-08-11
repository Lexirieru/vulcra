// (b) /earn list renders both pool rows (FXRP, wFLR) with TVL/APR columns and
//     links to /earn/[branch].
// (c) /earn/[branch] detail renders the stat bar + How it works + deposit panel.
import { test, expect } from "@playwright/test";
import { attachPageProbe, expectNoPageDefects, waitForShell } from "./support";

test.describe("/earn list", () => {
  test("renders both stability-pool rows with TVL/APR columns and branch links", async ({
    page,
  }) => {
    const probe = attachPageProbe(page);
    await page.goto("/earn", { waitUntil: "domcontentloaded" });
    await waitForShell(page);

    await expect(page.getByRole("heading", { name: "Earn", level: 1 })).toBeVisible();

    // Both pools present, each a link to its detail route.
    const fxrpRow = page.getByRole("link", { name: /FXRP Stability Pool/i });
    const wflrRow = page.getByRole("link", { name: /wFLR Stability Pool/i });
    await expect(fxrpRow).toBeVisible();
    await expect(wflrRow).toBeVisible();
    await expect(fxrpRow).toHaveAttribute("href", "/earn/fxrp");
    await expect(wflrRow).toHaveAttribute("href", "/earn/wflr");

    // TVL / APR columns are labelled. The live values render as numbers when
    // Coston2 RPC answers and as "—" otherwise; asserting the column labels is
    // the resilient invariant (values are exercised on the detail page).
    await expect(page.getByText("Pool TVL").first()).toBeVisible();
    await expect(page.getByText("APR", { exact: true }).first()).toBeVisible();

    expectNoPageDefects(probe);
  });

  test("clicking the FXRP row navigates to /earn/fxrp", async ({ page }) => {
    await page.goto("/earn", { waitUntil: "domcontentloaded" });
    await waitForShell(page);
    await page.getByRole("link", { name: /FXRP Stability Pool/i }).click();
    await expect(page).toHaveURL(/\/earn\/fxrp$/);
    await expect(
      page.getByRole("heading", { name: /FXRP Stability Pool/i, level: 1 }),
    ).toBeVisible();
  });
});

test.describe("/earn/[branch] detail", () => {
  for (const key of ["fxrp", "wflr"] as const) {
    test(`${key}: stat bar + How it works + deposit panel render`, async ({ page }) => {
      const probe = attachPageProbe(page);
      await page.goto(`/earn/${key}`, { waitUntil: "domcontentloaded" });
      await waitForShell(page);

      // Heading + "All pools" back link.
      await expect(
        page.getByRole("heading", { name: /Stability Pool/i, level: 1 }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: /All pools/i })).toHaveAttribute(
        "href",
        "/earn",
      );

      // Stat bar labels (values may be "—" without live RPC).
      await expect(page.getByText("Pool TVL")).toBeVisible();
      await expect(page.getByText("APR", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Your deposit")).toBeVisible();

      // "How it works" section.
      await expect(page.getByText("How it works")).toBeVisible();
      await expect(page.getByText(/Deposit vUSD/).first()).toBeVisible();

      // Deposit panel (no wallet connected → the EVM DepositPanel, titled
      // "Deposit vUSD", with an Amount field and a Deposit action).
      await expect(page.getByText("Deposit vUSD").first()).toBeVisible();
      await expect(page.getByRole("button", { name: /^Deposit$/ })).toBeVisible();

      expectNoPageDefects(probe);
    });
  }
});
