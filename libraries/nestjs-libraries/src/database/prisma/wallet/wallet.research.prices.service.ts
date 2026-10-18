import { Injectable, Logger } from '@nestjs/common';
import { WalletService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';

// The price row research data (dataRun on the MCP gateway) is charged by:
// one unit is one US dollar of source cost.
export const RESEARCH_ACTION_KEY = 'data.run';

const MAX_GROUPS = 50;
// Short: the public price list waits for this on a cold cache.
const GATEWAY_TIMEOUT_MS = 2000;

// One group of research data as the Prices page shows it: what it covers and
// what its cheapest and its dearest typical run cost, in hundredths of a
// credit, from the research price row.
export interface ResearchPrice {
  id: string;
  title: string;
  summary: string;
  // how many kinds of data the group holds
  runs: number;
  low: number;
  high: number;
}

// One gateway group as this service reads it: anything else is dropped.
export interface ResearchGroup {
  id: string;
  title: string;
  summary: string;
  runs: number;
  lowUsd: number;
  highUsd: number;
}

const clean = (value: unknown, max: number) => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().slice(0, max);
  return trimmed || undefined;
};

const cost = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

// One gateway group, or null when it has no usable id, title or costs.
export const toResearchGroup = (raw: any): ResearchGroup | null => {
  const id = clean(raw?.id, 60);
  const title = clean(raw?.title, 120);
  const lowUsd = cost(raw?.lowUsd);
  const highUsd = cost(raw?.highUsd);
  if (
    !id ||
    !/^[a-z0-9-]+$/.test(id) ||
    !title ||
    lowUsd === undefined ||
    highUsd === undefined ||
    lowUsd > highUsd
  ) {
    return null;
  }
  return {
    id,
    title,
    summary: clean(raw.summary, 400) || '',
    runs:
      Number.isInteger(raw.runs) && raw.runs > 0 ? Math.min(raw.runs, 1000) : 1,
    lowUsd,
    highUsd,
  };
};

// The research data the MCP gateway in front of this instance resells
// (MCP_GATEWAY_URL, GET /data), priced with the research price row: the
// gateway gives the source costs, this row the markup and the credit rate,
// so a price change in the database shows here as it does in the charge.
// Nothing without a gateway or an active row.
@Injectable()
export class WalletResearchPricesService {
  private readonly logger = new Logger(WalletResearchPricesService.name);

  constructor(private _wallet: WalletService) {}

  async prices(): Promise<{ groups: ResearchPrice[] }> {
    const priced = await this._wallet.price(RESEARCH_ACTION_KEY);
    if (!priced) {
      return { groups: [] };
    }
    const groups = await this.groups();
    return {
      groups: await Promise.all(
        groups.map(async (group) => ({
          id: group.id,
          title: group.title,
          summary: group.summary,
          runs: group.runs,
          low: await this._wallet.usagePrice(priced.action, group.lowUsd),
          high: await this._wallet.usagePrice(priced.action, group.highUsd),
        }))
      ),
    };
  }

  private async groups(): Promise<ResearchGroup[]> {
    const gateway = process.env.MCP_GATEWAY_URL?.replace(/\/+$/, '');
    if (!gateway) {
      return [];
    }
    try {
      const res = await fetch(`${gateway}/data`, {
        signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`gateway answered ${res.status}`);
      }
      const body = await res.json();
      const groups: unknown[] = Array.isArray(body?.groups) ? body.groups : [];
      return groups
        .slice(0, MAX_GROUPS)
        .map(toResearchGroup)
        .filter((group): group is ResearchGroup => !!group);
    } catch (err) {
      this.logger.warn(`Could not read the research data: ${String(err)}`);
      return [];
    }
  }
}
