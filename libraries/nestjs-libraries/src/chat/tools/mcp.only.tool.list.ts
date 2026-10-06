import { UploadWidgetTool } from '@gitroom/nestjs-libraries/chat/tools/upload.widget.tool';
import { UploadWidgetTicketTool } from '@gitroom/nestjs-libraries/chat/tools/upload.widget.ticket.tool';
import { UploadWidgetStatusTool } from '@gitroom/nestjs-libraries/chat/tools/upload.widget.status.tool';

// Tools that only work inside an MCP host (they render a ui:// widget), so the
// in-app agent never gets them: they are served by the MCP only (start.mcp.ts)
// and kept out of toolList.
export const mcpOnlyToolList = [
  UploadWidgetTool,
  UploadWidgetTicketTool,
  UploadWidgetStatusTool,
];
