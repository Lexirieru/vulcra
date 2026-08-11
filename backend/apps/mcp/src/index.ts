#!/usr/bin/env -S npx tsx
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { makeChainContext } from "./chain.js";
import { makeServices } from "./services.js";
import { registerReadTools } from "./tools/read.js";
import { registerQuoteTools } from "./tools/quote.js";
import { registerIntentTools } from "./tools/intent.js";
import type { ToolContext } from "./tools/shared.js";

/**
 * Vulcra MCP server — zero-custody CDP control for AI agents.
 *
 * Read tools query Coston2 (FTSOv2, VaultManager, StabilityPool) and the indexer;
 * intent tools return an UNSIGNED XRPL Payment (destination + drops + 0xFE memo)
 * plus the packed user-op, which the user signs in their own XRP wallet. This
 * process holds NO private keys and can sign NOTHING — the worst it can do is
 * propose a payment the user must explicitly approve.
 *
 * Transport is stdio (one client, e.g. Claude Code / Claude Desktop). All logging
 * goes to stderr so it never corrupts the JSON-RPC stream on stdout.
 */
async function main(): Promise<void> {
  const cfg = loadConfig();
  const ctx: ToolContext = {
    cfg,
    chain: makeChainContext(cfg),
    services: makeServices(cfg),
  };

  const server = new McpServer(
    { name: "vulcra", version: "0.1.0" },
    {
      instructions:
        "Vulcra is an XRPL-native, multi-collateral CDP stablecoin (vUSD) on Flare Coston2. " +
        "Users manage positions with only their XRP wallet — no EVM wallet or keys. " +
        "Use the get_* tools to read positions/health/branches and quote_* to preview. " +
        "The write tools (open_vault, adjust_vault, close_vault, earn_deposit, earn_withdraw) " +
        "NEVER sign anything: they return an unsigned XRPL Payment (destination, amountDrops, memoHex) " +
        "the user signs in their XRP wallet, then submits the tx hash + packedUserOpHex to the executor. " +
        "Always confirm amounts with the user before presenting a payment, and always quote before opening.",
    },
  );

  registerReadTools(server, ctx);
  registerQuoteTools(server, ctx);
  registerIntentTools(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[vulcra-mcp] ready on stdio — executor=${cfg.executorUrl} indexer=${cfg.indexerUrl} rpc=${cfg.rpcUrl}`,
  );
}

main().catch((err) => {
  console.error("[vulcra-mcp] fatal:", err);
  process.exit(1);
});
