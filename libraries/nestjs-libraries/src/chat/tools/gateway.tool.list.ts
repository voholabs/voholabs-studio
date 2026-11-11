import { WalletUsageTool } from '@gitroom/nestjs-libraries/chat/tools/wallet.usage.tool';
import { FlowsListTool } from '@gitroom/nestjs-libraries/chat/tools/flows.list.tool';
import { FlowGetTool } from '@gitroom/nestjs-libraries/chat/tools/flow.get.tool';
import { FlowSaveTool } from '@gitroom/nestjs-libraries/chat/tools/flow.save.tool';
import { FlowShareTool } from '@gitroom/nestjs-libraries/chat/tools/flow.share.tool';

// Tools only the MCP gateway (MCP_GATEWAY_SECRET) is served, never listed to
// an agent: they act for the gateway's own tools on the caller's behalf
// (charging the wallet for generation; the workspace's own flows behind its
// workflowList / workflowGet / workflowSave / workflowShare). Kept out of
// toolList and mcpOnlyToolList, so neither the in-app agent nor a direct MCP
// connection has them.
export const gatewayToolList = [
  WalletUsageTool,
  FlowsListTool,
  FlowGetTool,
  FlowSaveTool,
  FlowShareTool,
];
