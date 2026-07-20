/**
 * Vulcra landing page content.
 *
 * Single source of truth for all copy and outbound links. Sections import
 * from here so the server tree owns the text (see plan KTD2/KTD4) and every
 * placeholder link lives in one visible place to swap when real URLs land
 * (KTD5). A link with `isPlaceholder: true` renders a "coming soon"
 * affordance instead of a dead href.
 */

export type LinkItem = {
  label: string;
  href: string;
  /** True until the real URL is known; UI shows a coming-soon state. */
  isPlaceholder?: boolean;
  /** Opens in a new tab (external destinations). */
  external?: boolean;
};

/** A link is live (safe to render as a real anchor) when it isn't a placeholder. */
export function isLive(link: LinkItem): boolean {
  return !link.isPlaceholder;
}

// --- Centralized outbound URLs (swap placeholders as artifacts land) -------

const REPO_URL = "https://github.com/Lexirieru/vulcra";

/** App URL — filled once the dApp is deployed. */
const APP_URL: LinkItem = {
  label: "Launch App",
  href: "#",
  isPlaceholder: true,
  external: true,
};

/** Demo video — recorded near the end of the program. */
const DEMO_URL: LinkItem = {
  label: "Watch demo",
  href: "#",
  isPlaceholder: true,
  external: true,
};

/** Flare Summer Signal hackathon Telegram. */
const TELEGRAM_URL: LinkItem = {
  label: "Open Telegram",
  href: "#",
  isPlaceholder: true,
  external: true,
};

const REPO_LINK: LinkItem = {
  label: "View the code",
  href: REPO_URL,
  external: true,
};

// --- Site + navigation ------------------------------------------------------

export const SITE = {
  name: "Vulcra",
  tagline: "Forge dollars from your XRP.",
  description:
    "Vulcra is a CDP stablecoin on Flare. Lock FXRP as collateral, mint vUSD, repay to unlock — dollar liquidity from your XRP without selling.",
  url: "https://vulcra.xyz",
} as const;

export const NAV = {
  links: [
    { label: "How it works", href: "#how-it-works" },
    { label: "Architecture", href: "#architecture" },
    { label: "Bounty", href: "#bounty" },
  ],
  cta: APP_URL,
} as const;

// --- Hero -------------------------------------------------------------------

export const HERO = {
  eyebrow: "CDP stablecoin on Flare",
  // headline is split so the last word can wear the ember gradient
  headlineLead: "Forge dollars from your",
  headlineAccent: "XRP.",
  subhead:
    "Lock FXRP as collateral, mint vUSD, repay to unlock. Dollar liquidity from your XRP — without selling a single token.",
  primaryCta: APP_URL,
  secondaryCta: DEMO_URL,
} as const;

// --- Problem / Solution -----------------------------------------------------

export const PROBLEM_SOLUTION = {
  problem: {
    eyebrow: "The problem",
    title: "$100B+ of idle capital",
    body: "XRP is a $100B+ asset with no native smart contracts. To get dollar liquidity, holders sell — or borrow at variable pool rates. No CDP system exists on Flare.",
  },
  solution: {
    eyebrow: "Vulcra",
    title: "Dollars, without selling",
    body: "Vulcra turns FXRP into a collateralized dollar. Lock it, mint vUSD at a safe ratio, spend or trade, then repay to reclaim your FXRP. You keep your XRP exposure and get dollars on top.",
  },
} as const;

// --- How it works — 3 headlines ---------------------------------------------

export type Headline = {
  index: string;
  title: string;
  body: string;
  chip: string;
};

export const HOW_IT_WORKS: { eyebrow: string; title: string; items: Headline[] } = {
  eyebrow: "How it works",
  title: "One product, three headlines",
  items: [
    {
      index: "01",
      title: "Mint from XRPL in one payment.",
      body: "An XRP holder mints vUSD in a single atomic XRPL Payment via Smart Accounts (custom instruction 0xFE). No EVM wallet. No FLR. FXRP mint, vault open, and vUSD delivery execute together — or not at all.",
      chip: "Smart Accounts · 0xFE",
    },
    {
      index: "02",
      title: "A stablecoin with a real peg.",
      body: "Not an IOU. Liquidation clears under-collateralized vaults for a bonus; redemption lets anyone swap vUSD for FXRP at face value against the riskiest vaults first. Both floors, both real.",
      chip: "Liquidation + redemption",
    },
    {
      index: "03",
      title: "Vault Guardian, private in a TEE.",
      body: "Set protection rules — like auto-repay before liquidation — that live and execute only inside a Flare Confidential Compute TEE. Your rules aren't visible on-chain and can't be front-run before they fire.",
      chip: "FCC · code-hash attested",
    },
  ],
};

// --- Architecture -----------------------------------------------------------

export const ARCHITECTURE = {
  eyebrow: "Architecture",
  title: "Real Flare surface, no mocks",
  // Ordered left-to-right flow; each stage is a node in the diagram.
  flow: [
    { label: "XRPL Payment", detail: "0xFE memo" },
    { label: "FDC attestation", detail: "proof of payment" },
    { label: "Flare Coston2", detail: "FAssets · Smart Accounts · FTSOv2" },
    { label: "Vulcra core", detail: "vaults + vUSD" },
    { label: "TEE keeper + Guardian", detail: "FCC" },
  ],
  caption:
    "XRPL Payment → FDC attestation → Flare Coston2 (FAssets/FXRP, Smart Accounts, FTSOv2, Vulcra core: vaults + vUSD) → TEE keeper + Vault Guardian.",
  integrations: [
    "FTSOv2",
    "FAssets / FXRP",
    "Smart Accounts 0xFE",
    "FDC",
    "FCC / TEE",
    "ContractRegistry",
  ],
} as const;

// --- Bounty / judging angle -------------------------------------------------

export const BOUNTY = {
  eyebrow: "Built for Flare Summer Signal",
  title: "One product, two bounties",
  body: "Bounty 1 — Interoperable Asset Products: real FXRP CDP, live FTSO pricing, full peg, XRPL-native minting. Bounty 2 — Confidential Compute: a TEE liquidation keeper and Vault Guardian's private protection rules. Every integration is real on Coston2, and everything here was built during the program.",
  bounties: [
    {
      tag: "Bounty 1",
      title: "Interoperable Asset Products",
      note: "Real FXRP CDP · live FTSO pricing · full peg · XRPL-native minting.",
    },
    {
      tag: "Bounty 2",
      title: "Confidential Compute",
      note: "TEE liquidation keeper · Vault Guardian private protection rules.",
    },
  ],
  criteria: ["Useful", "Deep integration", "Real execution", "New work", "Clear"],
} as const;

// --- Resources --------------------------------------------------------------

export const RESOURCES: { eyebrow: string; title: string; items: LinkItem[] } = {
  eyebrow: "Resources",
  title: "Dig in",
  items: [
    { ...APP_URL, label: "Launch App" },
    REPO_LINK,
    { ...DEMO_URL, label: "Watch the demo" },
    { label: "Read the docs", href: REPO_URL, external: true },
  ],
};

// --- CTA footer -------------------------------------------------------------

export const CTA = {
  headline: "Join us in the forge.",
  body: "Follow the build and talk to us in the Flare Summer Signal Telegram.",
  cta: TELEGRAM_URL,
  footerLinks: [
    { ...APP_URL, label: "App" },
    { label: "GitHub", href: REPO_URL, external: true },
    { ...DEMO_URL, label: "Demo" },
    { label: "Docs", href: REPO_URL, external: true },
  ] as LinkItem[],
  disclaimer:
    "Vulcra runs on Coston2 (Flare testnet). Nothing here is financial advice.",
  builtNote: "Newly built during the Flare Summer Signal program.",
} as const;
