import { Logger } from '@nestjs/common';
import { AgentAuthMethod } from '@prisma/client';
import { RecordConnectionInput } from '@gitroom/nestjs-libraries/database/prisma/agent-connections/agent-connection.repository';
import {
  clientFromInfoName,
  clientFromUserAgent,
  readMcpBody,
} from '@gitroom/nestjs-libraries/database/prisma/agent-connections/agent.client';

export interface McpRequestSeen {
  organizationId: string;
  authMethod: Exclude<AgentAuthMethod, 'UNKNOWN'>;
  userAgent?: string;
  // The parsed JSON-RPC body; only the method, clientInfo.name and the tool
  // name are read from it.
  body?: unknown;
}

export interface RecorderOptions {
  throttleMs?: number;
  maxEntries?: number;
  now?: () => number;
}

type Entry = { lastWrite: number; pending: number; toolName?: string };

// Records MCP requests in the AgentConnection table without ever holding one
// up: `seen` returns at once and the write happens in the background, at most
// once per organization, client and sign-in method every `throttleMs`. The
// requests in between are counted in memory and added on the next write.
// Errors are logged and dropped.
export class AgentConnectionRecorder {
  private readonly logger = new Logger('AgentConnectionRecorder');
  private readonly entries = new Map<string, Entry>();
  // The client an organization's last `initialize` named, so the requests that
  // follow it (which only carry a User-Agent) are counted under the same name.
  private readonly lastClient = new Map<string, string>();
  private readonly throttleMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(
    private readonly write: (
      input: RecordConnectionInput
    ) => Promise<{ first: boolean }>,
    private readonly afterWrite?: (
      input: RecordConnectionInput,
      result: { first: boolean }
    ) => unknown,
    options: RecorderOptions = {}
  ) {
    this.throttleMs = options.throttleMs ?? 5 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 50000;
    this.now = options.now ?? Date.now;
  }

  seen(request: McpRequestSeen): void {
    try {
      this.handle(request);
    } catch (err) {
      this.logger.warn(`Could not note an MCP request: ${String(err)}`);
    }
  }

  private clientFor(request: McpRequestSeen, clientInfoName?: string) {
    const context = `${request.organizationId}|${request.authMethod}`;
    const named = clientFromInfoName(clientInfoName);
    if (named) {
      if (this.lastClient.size >= this.maxEntries) {
        this.lastClient.clear();
      }
      this.lastClient.set(context, named);
      return named;
    }
    const family = clientFromUserAgent(request.userAgent);
    return family !== 'other' ? family : this.lastClient.get(context) || family;
  }

  private handle(request: McpRequestSeen) {
    if (!request.organizationId) {
      return;
    }
    const { clientInfoName, toolName } = readMcpBody(request.body);
    const client = this.clientFor(request, clientInfoName);
    const key = `${request.organizationId}|${client}|${request.authMethod}`;
    const now = this.now();

    let entry = this.entries.get(key);
    if (!entry) {
      this.prune(now);
      entry = { lastWrite: Number.NEGATIVE_INFINITY, pending: 0 };
      this.entries.set(key, entry);
    }
    entry.pending += 1;
    if (toolName) {
      entry.toolName = toolName;
    }
    if (now - entry.lastWrite < this.throttleMs) {
      return;
    }

    const input: RecordConnectionInput = {
      organizationId: request.organizationId,
      client,
      authMethod: request.authMethod,
      at: new Date(now),
      requests: entry.pending,
      toolName: entry.toolName,
    };
    entry.lastWrite = now;
    entry.pending = 0;
    entry.toolName = undefined;

    const current = entry;
    Promise.resolve()
      .then(() => this.write(input))
      .then(async (result) => {
        try {
          await this.afterWrite?.(input, result);
        } catch (err) {
          this.logger.warn(`Agent connection follow-up failed: ${String(err)}`);
        }
      })
      .catch((err) => {
        // Keep the count for the next write.
        current.pending += input.requests;
        this.logger.warn(
          `Could not record an agent connection: ${String(err?.message || err)}`
        );
      });
  }

  // The map only holds rows written in the last few minutes; anything older
  // goes once it grows past maxEntries.
  private prune(now: number) {
    if (this.entries.size < this.maxEntries) {
      return;
    }
    for (const [key, entry] of this.entries) {
      if (now - entry.lastWrite >= this.throttleMs) {
        this.entries.delete(key);
      }
    }
    if (this.entries.size >= this.maxEntries) {
      this.entries.clear();
    }
  }
}
