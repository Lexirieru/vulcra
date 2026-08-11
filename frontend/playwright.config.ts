import { defineConfig, devices } from "@playwright/test";

// E2E for the Vulcra dApp. The dev server is assumed to be ALREADY running on
// :3000 (`npm run dev`) — Playwright does NOT start it (no `webServer` block),
// because the app needs the repo `.env` (NEXT_PUBLIC_*) and live Coston2 RPC
// that only the developer's shell has. See e2e/README.md.
//
// baseURL lets specs use path-only navigation (`page.goto("/earn")`).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry so `trace: "on-first-retry"` actually captures a trace, and so a
  // single slow first-compile (Next dev compiles a route on first hit) doesn't
  // fail the run.
  retries: 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    // Next dev compiles routes on first request; be generous.
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
