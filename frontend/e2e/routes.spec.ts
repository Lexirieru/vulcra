// (a) Every first-class route loads with HTTP 200, mounts the app shell, and
// raises no uncaught page error and no hydration mismatch.
import { test, expect } from "@playwright/test";
import { ROUTES, attachPageProbe, expectNoPageDefects, waitForShell } from "./support";

for (const route of ROUTES) {
  test(`route ${route} loads clean (200, shell, no pageerror/hydration)`, async ({ page }) => {
    const probe = attachPageProbe(page);

    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    // The document response for an App Router page is 200 for a valid route.
    expect(response, `no response for ${route}`).not.toBeNull();
    expect(response!.status(), `status for ${route}`).toBe(200);

    // The shell nav renders on every route regardless of wallet/RPC state.
    await waitForShell(page);

    // Give client hydration + the first render pass a beat to surface any
    // mismatch or thrown effect before we assert cleanliness.
    await page.waitForLoadState("networkidle").catch(() => {
      /* live RPC/indexer polling may keep the network busy — not a failure */
    });

    expectNoPageDefects(probe);
  });
}
