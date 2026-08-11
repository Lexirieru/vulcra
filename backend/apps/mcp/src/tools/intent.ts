import { z } from "zod";
import { resolveBranch, type McpBranch } from "../config.js";
import { buildEarnWithdrawPlan, type ManagePlanLike } from "../chain.js";
import type { BuildPlan } from "../services.js";
import {
  amountSchema,
  branchSchema,
  rAddressSchema,
  ratePercentSchema,
  result,
  safe,
  type Registrar,
  type ToolContext,
} from "./shared.js";
import { bpsToPercentStr, fromBaseUnits, percentToBps, toBaseUnits } from "../format.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Intent (write) tools. ZERO-CUSTODY: each returns an UNSIGNED XRPL Payment
 * (destination = FAssets Core Vault, amount in drops, 42-byte 0xFE memo) plus the
 * packed user-op and a human summary. The user signs it in their own XRP wallet;
 * this server never touches a key. After signing, the client submits the tx hash
 * + packedUserOpHex to the executor's /mint/submit to drive execution.
 */

/** Shape the standard zero-custody payload every intent tool returns. */
function intentResult(
  plan: BuildPlan | ManagePlanLike,
  branch: McpBranch,
  summary: string,
): CallToolResult {
  const unsignedXrplPayment = {
    // XRPL classic r-address of the FAssets Core Vault — the payment destination.
    destination: plan.coreVaultXrplAddress,
    // Exact drops to send (1 XRP = 1,000,000 drops).
    amountDrops: plan.requiredPaymentDrops,
    amountXrp: plan.requiredPaymentXrp,
    // 0xFE memo committing keccak256(userOp): 0x-prefixed and the raw XRPL MemoData hex.
    memoHex: plan.memo,
    xrplMemoData: plan.xrplMemoData,
    // CRITICAL: a destination tag reroutes the direct mint — the payment MUST carry none.
    destinationTag: null,
    noDestinationTag: true,
  };
  const structured = {
    branch: branch.key,
    unsignedXrplPayment,
    summary,
    memoUserOpHash: plan.userOpHash,
    packedUserOpHex: plan.userOpBytes,
    personalAccount: plan.personalAccount,
    nonce: plan.nonce,
    // Hand these to the executor after the XRPL payment confirms:
    submit: {
      endpoint: "/mint/submit",
      body: { packedUserOpHex: plan.userOpBytes, memoUserOpHash: plan.userOpHash, xrplTxId: "<XRPL tx hash after signing>" },
    },
  };
  const text =
    `${summary}\n\n` +
    `Sign this ONE XRPL payment in your XRP wallet (no EVM wallet, no keys shared):\n` +
    `- To (Core Vault): ${unsignedXrplPayment.destination}\n` +
    `- Amount: ${unsignedXrplPayment.amountXrp} XRP (${unsignedXrplPayment.amountDrops} drops)\n` +
    `- Memo (hex): ${unsignedXrplPayment.xrplMemoData}\n` +
    `- Destination tag: NONE (a tag would reroute the mint — do not add one)\n\n` +
    `After it confirms, POST { xrplTxId, packedUserOpHex, memoUserOpHash } to the executor's /mint/submit to execute.`;
  return result(text, structured);
}

const requireXrplBranch = (branch: McpBranch): void => {
  if (!branch.hasXrplMint) {
    throw new Error(`Branch ${branch.label} has no XRPL-native path. Only FXRP supports the zero-custody 0xFE flow.`);
  }
};

export const registerIntentTools: Registrar = (server, ctx: ToolContext) => {
  server.registerTool(
    "open_vault",
    {
      title: "Open a vault (unsigned)",
      description:
        "Build the UNSIGNED XRPL payment that opens a new FXRP vault and mints vUSD atomically via the 0xFE direct-minting path. Returns the payment (destination, drops, memo) for the user to sign in their XRP wallet — no keys are held or requested. Quote first with quote_open_vault.",
      inputSchema: {
        rAddress: rAddressSchema,
        branch: branchSchema,
        collateralAmount: amountSchema("FXRP collateral to deposit, in whole tokens (e.g. 100)."),
        mintAmount: amountSchema("vUSD to borrow, in whole vUSD (e.g. 50)."),
        annualInterestRatePercent: ratePercentSchema.optional(),
      },
    },
    safe(async (args) => {
      const p = z
        .object({
          rAddress: rAddressSchema,
          branch: branchSchema,
          collateralAmount: amountSchema(""),
          mintAmount: amountSchema(""),
          annualInterestRatePercent: ratePercentSchema.optional(),
        })
        .parse(args);
      const branch = resolveBranch(ctx.cfg, p.branch);
      requireXrplBranch(branch);
      const collateral6 = toBaseUnits(p.collateralAmount as string | number, branch.collateralDecimals);
      const mint18 = toBaseUnits(p.mintAmount as string | number, 18);
      const rateBps = p.annualInterestRatePercent !== undefined ? percentToBps(p.annualInterestRatePercent as string | number) : undefined;
      const plan = await ctx.services.buildMint({ xrplAddress: p.rAddress, collateral6, mint18, annualInterestRateBps: rateBps });
      const summary =
        `Open ${branch.label} vault for ${p.rAddress}: deposit ${fromBaseUnits(collateral6, branch.collateralDecimals)} ${branch.collateralSymbol}, ` +
        `mint ${fromBaseUnits(mint18, 18)} vUSD` +
        (rateBps !== undefined ? ` @ ${bpsToPercentStr(rateBps)}%/yr` : " at the default rate") +
        `.`;
      return intentResult(plan, branch, summary);
    }),
  );

  server.registerTool(
    "adjust_vault",
    {
      title: "Adjust a vault (unsigned)",
      description:
        "Build the UNSIGNED XRPL payment for an existing FXRP vault action: borrow more vUSD, repay vUSD, add FXRP collateral, withdraw FXRP collateral, or change the interest rate. Returns the payment to sign — zero-custody. The payment covers fees (and collateral, for add-collateral); no EVM wallet needed.",
      inputSchema: {
        rAddress: rAddressSchema,
        branch: branchSchema,
        action: z
          .enum(["borrow", "repay", "addCollateral", "withdrawCollateral", "adjustRate"])
          .describe("borrow = mint more vUSD; repay = burn vUSD; addCollateral / withdrawCollateral = FXRP; adjustRate = change interest rate."),
        amount: amountSchema("Amount for the action, whole units: vUSD for borrow/repay, FXRP for add/withdraw collateral. Omit for adjustRate.").optional(),
        newRatePercent: ratePercentSchema.optional().describe("New annual interest rate percent — required for adjustRate."),
      },
    },
    safe(async (args) => {
      const p = z
        .object({
          rAddress: rAddressSchema,
          branch: branchSchema,
          action: z.enum(["borrow", "repay", "addCollateral", "withdrawCollateral", "adjustRate"]),
          amount: amountSchema("").optional(),
          newRatePercent: ratePercentSchema.optional(),
        })
        .parse(args);
      const branch = resolveBranch(ctx.cfg, p.branch);
      requireXrplBranch(branch);

      let summary: string;
      let plan: BuildPlan;
      if (p.action === "borrow" || p.action === "repay") {
        if (p.amount === undefined) throw new Error(`amount (vUSD) is required for ${p.action}.`);
        const amount18 = toBaseUnits(p.amount as string | number, 18);
        plan = await ctx.services.buildManage({ xrplAddress: p.rAddress, action: p.action === "borrow" ? "mintMore" : "repay", amount18 });
        summary = `${p.action === "borrow" ? "Borrow" : "Repay"} ${fromBaseUnits(amount18, 18)} vUSD on the ${branch.label} vault for ${p.rAddress}.`;
      } else if (p.action === "addCollateral" || p.action === "withdrawCollateral") {
        if (p.amount === undefined) throw new Error(`amount (${branch.collateralSymbol}) is required for ${p.action}.`);
        const collateral6 = toBaseUnits(p.amount as string | number, branch.collateralDecimals);
        plan = await ctx.services.buildManage({ xrplAddress: p.rAddress, action: p.action, collateral6 });
        summary = `${p.action === "addCollateral" ? "Add" : "Withdraw"} ${fromBaseUnits(collateral6, branch.collateralDecimals)} ${branch.collateralSymbol} ${p.action === "addCollateral" ? "to" : "from"} the ${branch.label} vault for ${p.rAddress}.`;
      } else {
        if (p.newRatePercent === undefined) throw new Error("newRatePercent is required for adjustRate.");
        const newRateBps = percentToBps(p.newRatePercent as string | number);
        plan = await ctx.services.buildManage({ xrplAddress: p.rAddress, action: "adjustRate", newRateBps });
        summary = `Set the ${branch.label} vault interest rate to ${p.newRatePercent}%/yr for ${p.rAddress}.`;
      }
      return intentResult(plan, branch, summary);
    }),
  );

  server.registerTool(
    "close_vault",
    {
      title: "Close a vault (unsigned)",
      description:
        "Build the UNSIGNED XRPL payment that closes an FXRP vault: repays the entire debt (read live) and returns all collateral to the user's smart account. Requires the user to hold enough vUSD on that account. Returns the payment to sign — zero-custody.",
      inputSchema: { rAddress: rAddressSchema, branch: branchSchema },
    },
    safe(async (args) => {
      const p = z.object({ rAddress: rAddressSchema, branch: branchSchema }).parse(args);
      const branch = resolveBranch(ctx.cfg, p.branch);
      requireXrplBranch(branch);
      const plan = await ctx.services.buildManage({ xrplAddress: p.rAddress, action: "close" });
      const summary = `Close the ${branch.label} vault for ${p.rAddress}: repay the full debt and return all collateral.`;
      return intentResult(plan, branch, summary);
    }),
  );

  server.registerTool(
    "earn_deposit",
    {
      title: "Deposit to Earn (unsigned)",
      description:
        "Build the UNSIGNED XRPL payment that deposits vUSD held on the user's smart account into a branch's Stability Pool to earn yield ('borrow → earn' in one payment). Returns the payment to sign — zero-custody.",
      inputSchema: {
        rAddress: rAddressSchema,
        branch: branchSchema,
        amount: amountSchema("vUSD to deposit into the Stability Pool, in whole vUSD."),
      },
    },
    safe(async (args) => {
      const p = z.object({ rAddress: rAddressSchema, branch: branchSchema, amount: amountSchema("") }).parse(args);
      const branch = resolveBranch(ctx.cfg, p.branch);
      requireXrplBranch(branch);
      const amount18 = toBaseUnits(p.amount as string | number, 18);
      const plan = await ctx.services.buildManage({ xrplAddress: p.rAddress, action: "spDeposit", amount18 });
      const summary = `Deposit ${fromBaseUnits(amount18, 18)} vUSD into the ${branch.label} Stability Pool (Earn) for ${p.rAddress}.`;
      return intentResult(plan, branch, summary);
    }),
  );

  server.registerTool(
    "earn_withdraw",
    {
      title: "Withdraw from Earn (unsigned)",
      description:
        "Build the UNSIGNED XRPL payment that withdraws vUSD from a branch's Stability Pool (also claims pending rewards) back to the user's smart account. Returns the payment to sign — zero-custody. Assembled from the shared user-op builder (the executor has no SP-withdraw endpoint yet).",
      inputSchema: {
        rAddress: rAddressSchema,
        branch: branchSchema,
        amount: amountSchema("vUSD to withdraw from the Stability Pool, in whole vUSD."),
      },
    },
    safe(async (args) => {
      const p = z.object({ rAddress: rAddressSchema, branch: branchSchema, amount: amountSchema("") }).parse(args);
      const branch = resolveBranch(ctx.cfg, p.branch);
      requireXrplBranch(branch);
      const amount18 = toBaseUnits(p.amount as string | number, 18);
      const plan = await buildEarnWithdrawPlan(ctx.chain, branch, p.rAddress, amount18);
      const summary = `Withdraw ${fromBaseUnits(amount18, 18)} vUSD (plus pending rewards) from the ${branch.label} Stability Pool for ${p.rAddress}.`;
      return intentResult(plan, branch, summary);
    }),
  );
};
