import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpConfig } from "../config.js";
import type { ChainContext } from "../chain.js";
import type { Services } from "../services.js";

/** Everything a tool handler needs, threaded from index.ts. */
export interface ToolContext {
  cfg: McpConfig;
  chain: ChainContext;
  services: Services;
}

/** A registered tool's raw zod shape (McpServer wants a ZodRawShape, not z.object). */
export type ToolShape = z.ZodRawShape;

/** XRPL classic r-address (base58, starts with `r`). */
export const rAddressSchema = z
  .string()
  .regex(/^r[1-9A-HJ-NP-Za-km-z]{23,50}$/, "Must be an XRPL classic r-address (starts with 'r').")
  .describe("XRPL classic r-address that owns / will own the position (e.g. rQBC...). This is the user's XRP wallet — no EVM wallet is needed.");

/** Branch selector, case-insensitive, defaults to FXRP. */
export const branchSchema = z
  .preprocess(
    (v) => (typeof v === "string" ? v.toUpperCase() : v),
    z.enum(["FXRP", "WFLR"]),
  )
  .default("FXRP")
  .describe("Collateral branch: FXRP (XRPL-native, 0xFE atomic mint) or WFLR. Defaults to FXRP.");

/** A human token amount ("100", "12.5"); string or number both accepted. */
export const amountSchema = (label: string) =>
  z
    .union([z.string(), z.number()])
    .describe(label);

/** An annual interest rate as a percent ("5", "1.5"). */
export const ratePercentSchema = z
  .union([z.string(), z.number()])
  .describe("Annual interest rate as a percent, e.g. 5 for 5%/yr. Bounded by the branch's min/max rate.");

/** Wrap a handler so any thrown error is returned as an MCP error result (never crashes the server). */
export function safe(
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>,
): (args: Record<string, unknown>) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${message}` }],
      };
    }
  };
}

/** Build a standard success result: human text + structured payload. */
export function result(text: string, structured: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent: structured,
  };
}

export type Registrar = (server: McpServer, ctx: ToolContext) => void;
