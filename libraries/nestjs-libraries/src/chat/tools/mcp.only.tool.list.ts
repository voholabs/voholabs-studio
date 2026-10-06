import { UploadWidgetTool } from '@gitroom/nestjs-libraries/chat/tools/upload.widget.tool';
import { UploadWidgetTicketTool } from '@gitroom/nestjs-libraries/chat/tools/upload.widget.ticket.tool';
import { UploadWidgetStatusTool } from '@gitroom/nestjs-libraries/chat/tools/upload.widget.status.tool';
import { UploadChatFileTool } from '@gitroom/nestjs-libraries/chat/tools/upload.chat.file.tool';

// Tools that only work inside an MCP host (a ui:// widget, or a file the host
// attaches), so the
// in-app agent never gets them: they are served by the MCP only (start.mcp.ts)
// and kept out of toolList.
export const mcpOnlyToolList = [
  UploadWidgetTool,
  UploadWidgetTicketTool,
  UploadWidgetStatusTool,
  UploadChatFileTool,
];
