import { defineConfig, devices } from "@playwright/test";

// E2E for the Vulcra dApp. Runs against the PRODUCTION build (`next build` +
// `next start`), NOT the dev server: `next dev`'s HMR/overlay/source-map scripts
// throw a benign "Invalid or unexpected token" in Playwright's bundled Chromium
// on every route, which is dev-only noise (real Chrome + the production build are
// clean). Production is the representative surface judges see, so we test it.
//
// `webServer` builds + starts on :3000; `reuseExistingServer` reuses a server you
// already have up (fast local iteration — e.g. `npx next start -p 3000`). The app
// still needs the repo `.env` (NEXT_PUBLIC_*) + live Coston2 RPC. See e2e/README.md.
//
// baseURL lets specs use path-only navigation (`page.goto("/earn")`).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry so `trace: "on-first-retry"` captures a trace, and a single slow
  // first live-RPC price read (the "Max" borrow value) doesn't flake the run.
  retries: 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  webServer: {
    command: "npm run build && npx next start -p 3000",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
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
