import { z } from "zod";
import { resolveBranch } from "../config.js";
import {
  readBranchParams,
  readBranchPrice,
  readVault,
  computeHealth,
  resolvePersonalAccount,
  readEarnPosition,
} from "../chain.js";
import { bpsToPercentStr, fromBaseUnits, usd18 } from "../format.js";
import { branchSchema, rAddressSchema, result, safe, type Registrar } from "./shared.js";

/**
 * Read-only tools. Every figure is live: FTSOv2 for price, the VaultManager for
 * vault state + params, the StabilityPool for Earn, the indexer for the at-risk
 * set. No keys, no writes.
 */
export const registerReadTools: Registrar = (server, ctx) => {
  server.registerTool(
    "get_branches",
    {
      title: "List collateral branches",
      description:
        "List Vulcra's collateral branches (FXRP, wFLR) with each branch's live price, minimum collateral ratio (MCR), mint fee, minimum debt, and interest-rate bounds. Start here to learn what can be borrowed against and the current risk parameters.",
      inputSchema: {},
    },
    safe(async () => {
      const out: Array<Record<string, unknown>> = [];
      const lines: string[] = [];
      for (const branch of Object.values(ctx.cfg.branches)) {
        const [params, price] = await Promise.all([
          readBranchParams(ctx.chain, branch).catch((e) => ({ error: (e as Error).message })),
          readBranchPrice(ctx.chain, branch).catch((e) => ({ error: (e as Error).message })),
        ]);
        const priceStr =
          "price18" in price ? usd18(price.price18) : `unavailable (${(price as { error: string }).error})`;
        const p = "mcrBps" in params ? params : null;
        out.push({
          key: branch.key,
          label: branch.label,
          collateralSymbol: branch.collateralSymbol,
          collateralDecimals: branch.collateralDecimals,
          vaultManager: branch.vaultManager,
          stabilityPool: branch.stabilityPool,
          hasXrplMint: branch.hasXrplMint,
          feed: branch.feedLabel,
          price: "price18" in price ? usd18(price.price18) : null,
          priceStale: "stale" in price ? price.stale : null,
          mcrPercent: p ? bpsToPercentStr(p.mcrBps) : null,
          mintFeePercent: p ? bpsToPercentStr(p.mintFeeBps) : null,
          minDebtVusd: p ? fromBaseUnits(p.minDebt18, 18) : null,
          interestRatePercent: p
            ? { min: bpsToPercentStr(p.minInterestRateBps), max: bpsToPercentStr(p.maxInterestRateBps), default: bpsToPercentStr(p.defaultInterestRateBps) }
            : null,
        });
        lines.push(
          `${branch.label} (${branch.feedLabel} ${priceStr})` +
            (p
              ? `: MCR ${bpsToPercentStr(p.mcrBps)}%, mint fee ${bpsToPercentStr(p.mintFeeBps)}%, min debt ${fromBaseUnits(p.minDebt18, 18)} vUSD, rate ${bpsToPercentStr(p.minInterestRateBps)}–${bpsToPercentStr(p.maxInterestRateBps)}%/yr` +
              `, XRPL-native mint ${branch.hasXrplMint ? "yes" : "no"}`
              : ""),
        );
      }
      return result(`Vulcra branches on Coston2:\n- ${lines.join("\n- ")}`, { branches: out });
    }),
  );

  server.registerTool(
    "get_vault",
    {
      title: "Get vault position",
      description:
        "Read the CDP position for an XRPL r-address in a branch: collateral, debt (vUSD, incl. accrued interest), interest rate, collateral ratio and whether it is active. The r-address is mapped to its deterministic EVM smart account on-chain.",
      inputSchema: { rAddress: rAddressSchema, branch: branchSchema },
    },
    safe(async (args) => {
      const { rAddress, branch: branchKey } = z.object({ rAddress: rAddressSchema, branch: branchSchema }).parse(args);
      const branch = resolveBranch(ctx.cfg, branchKey);
      const owner = await resolvePersonalAccount(ctx.chain, rAddress);
      const [vault, price, params] = await Promise.all([
        readVault(ctx.chain, branch, owner),
        readBranchPrice(ctx.chain, branch),
        readBranchParams(ctx.chain, branch),
      ]);
      if (!vault.active && vault.collateral6 === 0n && vault.debt18 === 0n) {
        return result(`No active ${branch.label} vault for ${rAddress} (smart account ${owner}).`, {
          rAddress,
          personalAccount: owner,
          branch: branch.key,
          active: false,
        });
      }
      const health = computeHealth(vault, branch, price, params);
      const collateralHuman = fromBaseUnits(vault.collateral6, branch.collateralDecimals);
      const debtHuman = fromBaseUnits(vault.debt18, 18);
      const structured = {
        rAddress,
        personalAccount: owner,
        branch: branch.key,
        active: vault.active,
        collateral: collateralHuman,
        collateralSymbol: branch.collateralSymbol,
        collateralUsd: usd18(health.collateralUsd18),
        debtVusd: debtHuman,
        interestRatePercent: bpsToPercentStr(vault.rateBps),
        collateralRatioPercent: bpsToPercentStr(health.crBps),
        mcrPercent: bpsToPercentStr(params.mcrBps),
        liquidationPrice: health.liquidationPrice18 ? usd18(health.liquidationPrice18) : null,
        isLiquidatable: health.isLiquidatable,
        currentPrice: usd18(price.price18),
      };
      const text =
        `${branch.label} vault for ${rAddress}:\n` +
        `- Collateral: ${collateralHuman} ${branch.collateralSymbol} (${usd18(health.collateralUsd18)})\n` +
        `- Debt: ${debtHuman} vUSD @ ${bpsToPercentStr(vault.rateBps)}%/yr\n` +
        `- Collateral ratio: ${bpsToPercentStr(health.crBps)}% (MCR ${bpsToPercentStr(params.mcrBps)}%)\n` +
        `- Liquidation price: ${health.liquidationPrice18 ? usd18(health.liquidationPrice18) : "n/a"} (current ${usd18(price.price18)})` +
        (health.isLiquidatable ? "\n- ⚠️ BELOW MCR — liquidatable now" : "");
      return result(text, structured);
    }),
  );

  server.registerTool(
    "get_vault_health",
    {
      title: "Get vault health",
      description:
        "Risk-focused view of a vault: current collateral ratio (ICR), the FTSOv2 liquidation price, the price buffer to liquidation, and whether it is liquidatable right now. Use to answer 'how safe is my position?'.",
      inputSchema: { rAddress: rAddressSchema, branch: branchSchema },
    },
    safe(async (args) => {
      const { rAddress, branch: branchKey } = z.object({ rAddress: rAddressSchema, branch: branchSchema }).parse(args);
      const branch = resolveBranch(ctx.cfg, branchKey);
      const owner = await resolvePersonalAccount(ctx.chain, rAddress);
      const [vault, price, params] = await Promise.all([
        readVault(ctx.chain, branch, owner),
        readBranchPrice(ctx.chain, branch),
        readBranchParams(ctx.chain, branch),
      ]);
      if (vault.debt18 === 0n) {
        return result(`No debt on the ${branch.label} vault for ${rAddress} — nothing at risk.`, {
          rAddress,
          personalAccount: owner,
          branch: branch.key,
          hasDebt: false,
        });
      }
      const health = computeHealth(vault, branch, price, params);
      const bufferPct = health.bufferBps !== null ? bpsToPercentStr(health.bufferBps) : null;
      const structured = {
        rAddress,
        personalAccount: owner,
        branch: branch.key,
        collateralRatioPercent: bpsToPercentStr(health.crBps),
        mcrPercent: bpsToPercentStr(params.mcrBps),
        currentPrice: usd18(price.price18),
        priceStale: price.stale,
        liquidationPrice: health.liquidationPrice18 ? usd18(health.liquidationPrice18) : null,
        priceBufferPercent: bufferPct,
        isLiquidatable: health.isLiquidatable,
      };
      const text =
        `${branch.label} vault health for ${rAddress}:\n` +
        `- ICR: ${bpsToPercentStr(health.crBps)}% vs MCR ${bpsToPercentStr(params.mcrBps)}%\n` +
        `- ${branch.feedLabel} now ${usd18(price.price18)}${price.stale ? " (stale!)" : ""}, liquidation at ${health.liquidationPrice18 ? usd18(health.liquidationPrice18) : "n/a"}\n` +
        `- Buffer to liquidation: ${bufferPct !== null ? bufferPct + "%" : "n/a"}` +
        (health.isLiquidatable ? "\n- ⚠️ LIQUIDATABLE NOW — add collateral or repay." : "");
      return result(text, structured);
    }),
  );

  server.registerTool(
    "get_at_risk_vaults",
    {
      title: "List at-risk vaults",
      description:
        "List vaults in a branch whose collateral ratio is below a threshold (default 130%), riskiest first — the liquidation candidates a keeper would watch. Served by the indexer.",
      inputSchema: {
        branch: branchSchema,
        belowCrPercent: z
          .union([z.string(), z.number()])
          .optional()
          .describe("CR threshold in percent (default 130). Vaults with CR below this are returned."),
      },
    },
    safe(async (args) => {
      const parsed = z
        .object({ branch: branchSchema, belowCrPercent: z.union([z.string(), z.number()]).optional() })
        .parse(args);
      const branch = resolveBranch(ctx.cfg, parsed.branch);
      const belowCrBps =
        parsed.belowCrPercent !== undefined ? BigInt(Math.round(Number(parsed.belowCrPercent) * 100)) : undefined;
      const res = await ctx.services.atRisk(branch.key, belowCrBps);
      const vaults = res.vaults.map((v) => ({
        owner: v.owner,
        collateral: fromBaseUnits(BigInt(v.collateral), branch.collateralDecimals),
        debtVusd: fromBaseUnits(BigInt(v.currentDebt18), 18),
        collateralRatioPercent: bpsToPercentStr(BigInt(v.crBps)),
        interestRatePercent: bpsToPercentStr(BigInt(v.rateBps)),
      }));
      const text =
        `${res.count} ${branch.label} vault(s) below ${bpsToPercentStr(BigInt(res.belowCrBps))}% CR ` +
        `(${branch.feedLabel} ${usd18(BigInt(res.price.price18))}):\n` +
        (vaults.length
          ? vaults.map((v) => `- ${v.owner}: CR ${v.collateralRatioPercent}%, ${v.debtVusd} vUSD, ${v.collateral} ${branch.collateralSymbol}`).join("\n")
          : "- none");
      return result(text, { branch: branch.key, count: res.count, thresholdPercent: bpsToPercentStr(BigInt(res.belowCrBps)), vaults });
    }),
  );

  server.registerTool(
    "get_earn_position",
    {
      title: "Get Earn (Stability Pool) position",
      description:
        "Read an r-address's Earn deposit in a branch's Stability Pool: the deposited vUSD, the pool's total deposits (TVL), and the live + trailing-7d APR. Earn deposits absorb liquidations and earn yield.",
      inputSchema: { rAddress: rAddressSchema, branch: branchSchema },
    },
    safe(async (args) => {
      const { rAddress, branch: branchKey } = z.object({ rAddress: rAddressSchema, branch: branchSchema }).parse(args);
      const branch = resolveBranch(ctx.cfg, branchKey);
      const owner = await resolvePersonalAccount(ctx.chain, rAddress);
      const pos = await readEarnPosition(ctx.chain, branch, owner);
      const structured = {
        rAddress,
        personalAccount: owner,
        branch: branch.key,
        stabilityPool: branch.stabilityPool,
        depositVusd: fromBaseUnits(pos.deposit18, 18),
        poolTvlVusd: fromBaseUnits(pos.totalDeposits18, 18),
        aprPercent: bpsToPercentStr(pos.aprBps),
        apr7dPercent: bpsToPercentStr(pos.apr7dBps),
      };
      const text =
        `${branch.label} Earn position for ${rAddress}:\n` +
        `- Your deposit: ${fromBaseUnits(pos.deposit18, 18)} vUSD\n` +
        `- Pool TVL: ${fromBaseUnits(pos.totalDeposits18, 18)} vUSD\n` +
        `- APR: ${bpsToPercentStr(pos.aprBps)}% (7d ${bpsToPercentStr(pos.apr7dBps)}%)`;
      return result(text, structured);
    }),
  );
};
