import { WalletUsageTool } from '@gitroom/nestjs-libraries/chat/tools/wallet.usage.tool';

// Tools only the MCP gateway (MCP_GATEWAY_SECRET) is served, never listed to
// an agent: they act for the gateway's own tools on the caller's behalf
// (charging the wallet for generation). Kept out of toolList and
// mcpOnlyToolList, so neither the in-app agent nor a direct MCP connection
// has them.
export const gatewayToolList = [WalletUsageTool];
