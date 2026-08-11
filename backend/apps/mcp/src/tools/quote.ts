import { z } from "zod";
import { resolveBranch } from "../config.js";
import {
  readBranchParams,
  readBranchPrice,
  previewOpen,
  resolvePersonalAccount,
  readVault,
} from "../chain.js";
import { collateralValueUsd18At } from "@vulcra/chain-client";
import { amountSchema, branchSchema, rAddressSchema, result, safe, type Registrar } from "./shared.js";
import { bpsToPercentStr, fromBaseUnits, toBaseUnits, usd18 } from "../format.js";

/**
 * Quote tools — pure "what if" math, no payment built. Feasibility is authoritative
 * (VaultManager.previewOpen); max-borrow is derived from live price + MCR.
 */
export const registerQuoteTools: Registrar = (server, ctx) => {
  server.registerTool(
    "quote_open_vault",
    {
      title: "Quote opening a vault",
      description:
        "Preview opening a vault with a given collateral amount and vUSD mint: returns the resulting debt (incl. mint fee), collateral ratio, and whether it is feasible (meets the MCR and minimum debt). Does NOT build a payment — use open_vault for that.",
      inputSchema: {
        branch: branchSchema,
        collateralAmount: amountSchema("Collateral to deposit, in whole tokens (e.g. 100 for 100 FXRP)."),
        mintAmount: amountSchema("vUSD to borrow, in whole vUSD (e.g. 50)."),
      },
    },
    safe(async (args) => {
      const parsed = z
        .object({ branch: branchSchema, collateralAmount: amountSchema(""), mintAmount: amountSchema("") })
        .parse(args);
      const branch = resolveBranch(ctx.cfg, parsed.branch);
      const collateral6 = toBaseUnits(parsed.collateralAmount as string | number, branch.collateralDecimals);
      const mint18 = toBaseUnits(parsed.mintAmount as string | number, 18);
      const [preview, price, params] = await Promise.all([
        previewOpen(ctx.chain, branch, collateral6, mint18),
        readBranchPrice(ctx.chain, branch),
        readBranchParams(ctx.chain, branch),
      ]);
      const collateralUsd18 = collateralValueUsd18At(collateral6, branch.collateralDecimals, price.value, price.decimals);
      const feePaid18 = preview.debt18 - mint18;
      const feasible = preview.meetsMcr && preview.meetsMinDebt;
      const structured = {
        branch: branch.key,
        collateral: fromBaseUnits(collateral6, branch.collateralDecimals),
        collateralUsd: usd18(collateralUsd18),
        mintVusd: fromBaseUnits(mint18, 18),
        debtVusd: fromBaseUnits(preview.debt18, 18),
        mintFeeVusd: fromBaseUnits(feePaid18 > 0n ? feePaid18 : 0n, 18),
        collateralRatioPercent: bpsToPercentStr(preview.crBps),
        mcrPercent: bpsToPercentStr(params.mcrBps),
        meetsMcr: preview.meetsMcr,
        meetsMinDebt: preview.meetsMinDebt,
        feasible,
        currentPrice: usd18(price.price18),
      };
      const text =
        `Quote — open ${branch.label} vault with ${fromBaseUnits(collateral6, branch.collateralDecimals)} ${branch.collateralSymbol} (${usd18(collateralUsd18)}), mint ${fromBaseUnits(mint18, 18)} vUSD:\n` +
        `- Debt (incl. fee): ${fromBaseUnits(preview.debt18, 18)} vUSD (mint fee ${fromBaseUnits(feePaid18 > 0n ? feePaid18 : 0n, 18)})\n` +
        `- Collateral ratio: ${bpsToPercentStr(preview.crBps)}% (MCR ${bpsToPercentStr(params.mcrBps)}%)\n` +
        `- Feasible: ${feasible ? "yes ✅" : "no ❌"}` +
        (feasible ? "" : ` (${!preview.meetsMcr ? "below MCR" : ""}${!preview.meetsMcr && !preview.meetsMinDebt ? ", " : ""}${!preview.meetsMinDebt ? "below min debt" : ""})`);
      return result(text, structured);
    }),
  );

  server.registerTool(
    "quote_max_borrow",
    {
      title: "Quote maximum borrow",
      description:
        "Given a collateral amount (or an existing r-address vault), compute the maximum vUSD borrowable at a target collateral ratio. Defaults to the branch MCR (the absolute max — no safety margin); pass a higher targetCrPercent (e.g. 150) for a safer number. Provide EITHER collateralAmount for a hypothetical new vault, OR rAddress to size additional borrow on an existing vault.",
      inputSchema: {
        branch: branchSchema,
        collateralAmount: amountSchema("Collateral in whole tokens for a hypothetical new vault. Omit if using rAddress.").optional(),
        rAddress: rAddressSchema.optional(),
        targetCrPercent: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Target collateral ratio in percent (default = branch MCR). Higher = safer, less borrow."),
      },
    },
    safe(async (args) => {
      const parsed = z
        .object({
          branch: branchSchema,
          collateralAmount: z.union([z.string(), z.number()]).optional(),
          rAddress: rAddressSchema.optional(),
          targetCrPercent: z.union([z.string(), z.number()]).optional(),
        })
        .parse(args);
      const branch = resolveBranch(ctx.cfg, parsed.branch);
      const [price, params] = await Promise.all([
        readBranchPrice(ctx.chain, branch),
        readBranchParams(ctx.chain, branch),
      ]);
      const targetCrBps =
        parsed.targetCrPercent !== undefined ? BigInt(Math.round(Number(parsed.targetCrPercent) * 100)) : params.mcrBps;
      if (targetCrBps < params.mcrBps) {
        throw new Error(`targetCrPercent ${bpsToPercentStr(targetCrBps)}% is below the MCR ${bpsToPercentStr(params.mcrBps)}% — not feasible.`);
      }

      let collateral6: bigint;
      let existingDebt18 = 0n;
      let subjectLabel: string;
      if (parsed.rAddress) {
        const owner = await resolvePersonalAccount(ctx.chain, parsed.rAddress);
        const vault = await readVault(ctx.chain, branch, owner);
        collateral6 = vault.collateral6;
        existingDebt18 = vault.debt18;
        subjectLabel = `existing vault ${parsed.rAddress}`;
        if (collateral6 === 0n) throw new Error(`No ${branch.label} collateral for ${parsed.rAddress}. Open a vault first or pass collateralAmount.`);
      } else if (parsed.collateralAmount !== undefined) {
        collateral6 = toBaseUnits(parsed.collateralAmount as string | number, branch.collateralDecimals);
        subjectLabel = `${fromBaseUnits(collateral6, branch.collateralDecimals)} ${branch.collateralSymbol}`;
      } else {
        throw new Error("Provide either collateralAmount (new vault) or rAddress (existing vault).");
      }

      const collateralUsd18 = collateralValueUsd18At(collateral6, branch.collateralDecimals, price.value, price.decimals);
      // Max TOTAL debt so that collateralUsd/debt >= targetCr.
      const maxDebt18 = (collateralUsd18 * 10000n) / targetCrBps;
      const additionalDebt18 = maxDebt18 > existingDebt18 ? maxDebt18 - existingDebt18 : 0n;
      // Borrowable principal before the mint fee: debt = mint * (10000 + feeBps)/10000.
      const maxMint18 = (additionalDebt18 * 10000n) / (10000n + params.mintFeeBps);

      const structured = {
        branch: branch.key,
        subject: subjectLabel,
        collateral: fromBaseUnits(collateral6, branch.collateralDecimals),
        collateralUsd: usd18(collateralUsd18),
        existingDebtVusd: fromBaseUnits(existingDebt18, 18),
        targetCrPercent: bpsToPercentStr(targetCrBps),
        maxTotalDebtVusd: fromBaseUnits(maxDebt18, 18),
        maxAdditionalBorrowVusd: fromBaseUnits(maxMint18, 18),
        mintFeePercent: bpsToPercentStr(params.mintFeeBps),
        currentPrice: usd18(price.price18),
      };
      const text =
        `Max borrow for ${subjectLabel} at ${bpsToPercentStr(targetCrBps)}% CR (${branch.feedLabel} ${usd18(price.price18)}):\n` +
        `- Collateral value: ${usd18(collateralUsd18)}\n` +
        (existingDebt18 > 0n ? `- Existing debt: ${fromBaseUnits(existingDebt18, 18)} vUSD\n` : "") +
        `- Max additional borrow: ${fromBaseUnits(maxMint18, 18)} vUSD (after ${bpsToPercentStr(params.mintFeeBps)}% mint fee)`;
      return result(text, structured);
    }),
  );
};
