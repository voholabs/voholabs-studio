import { Injectable, Logger } from '@nestjs/common';

// How long one catalog read from the gateway is served before it is read again.
export const FLOWS_TTL_MS = 60_000;

// Exactly what the Flows page reads. Anything else the gateway sends is
// dropped, so the page only ever gets these fields, in these shapes.
export interface FlowSummary {
  id: string;
  title: string;
  summary: string;
  example?: string;
  exampleVideo?: string;
  // where the sample can be seen whole as a page (the published blog post)
  exampleLink?: string;
  poster?: string;
  // every image of a sample that is a set (a carousel's slides), in order,
  // the poster first
  exampleImages?: string[];
  category?: 'video' | 'image' | 'writing' | 'marketing';
  cost?: string;
  // the credit figure of cost, worked out by the gateway: "~10-15 credits"
  costEstimate?: string;
  prompt?: string;
  free?: boolean;
  // the playbook uses paid research data, which opens with Plus; without it
  // the flow runs on free web research
  paidResearch?: boolean;
  featured?: boolean;
  addedAt?: string;
  aspect?: '16:9' | '9:16' | '1:1' | '4:5';
  duration?: string;
  inputs?: string[];
  outputs?: string[];
  tags?: string[];
}

const FLOW_CATEGORIES = ['video', 'image', 'writing', 'marketing'] as const;
const FLOW_ASPECTS = ['16:9', '9:16', '1:1', '4:5'] as const;
const MAX_FLOWS = 200;
const MAX_LIST_ITEMS = 20;
const MAX_EXAMPLE_IMAGES = 12;

const clean = (value: unknown, max: number) => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().slice(0, max);
  return trimmed || undefined;
};

const textList = (value: unknown, max = 200) => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const list = value
    .map((one) => clean(one, max))
    .filter((one): one is string => !!one)
    .slice(0, MAX_LIST_ITEMS);
  return list.length ? list : undefined;
};

const httpsUrl = (value: unknown) => {
  const url = clean(value, 2048);
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
};

// A list of https links, at most max of them; none when fewer than two are
// usable, since one image is the poster alone
const httpsUrls = (value: unknown, max: number) => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const list = value
    .map(httpsUrl)
    .filter((one): one is string => !!one)
    .slice(0, max);
  return list.length > 1 ? list : undefined;
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]) =>
  allowed.includes(value as T) ? (value as T) : undefined;

const flag = (value: unknown) => (value === true ? true : undefined);

// One gateway flow as the page may see it, or null when it has no usable id
// or title. The id ends up in the page URL, so it is limited to slug
// characters.
export const toFlowSummary = (raw: any): FlowSummary | null => {
  const id = clean(raw?.id, 100);
  const title = clean(raw?.title, 160);
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id) || !title) {
    return null;
  }
  const flow: FlowSummary = {
    id,
    title,
    summary: clean(raw.summary, 1000) || '',
    example: clean(raw.example, 1000),
    exampleVideo: httpsUrl(raw.exampleVideo),
    exampleLink: httpsUrl(raw.exampleLink),
    poster: httpsUrl(raw.poster),
    exampleImages: httpsUrls(raw.exampleImages, MAX_EXAMPLE_IMAGES),
    category: oneOf(raw.category, FLOW_CATEGORIES),
    cost: clean(raw.cost, 300),
    costEstimate: clean(raw.costEstimate, 60),
    prompt: clean(raw.prompt, 8000),
    free: flag(raw.free),
    paidResearch: flag(raw.paidResearch),
    featured: flag(raw.featured),
    addedAt: clean(raw.addedAt, 40),
    aspect: oneOf(raw.aspect, FLOW_ASPECTS),
    duration: clean(raw.duration, 100),
    inputs: textList(raw.inputs),
    outputs: textList(raw.outputs),
    tags: textList(raw.tags, 40),
  };
  return Object.fromEntries(
    Object.entries(flow).filter(([, value]) => value !== undefined)
  ) as FlowSummary;
};

// The flows catalog comes from the MCP gateway in front of this instance
// (MCP_GATEWAY_URL), which owns the flows. Without a gateway there are none.
@Injectable()
export class FlowsService {
  private readonly logger = new Logger(FlowsService.name);
  private _cache?: { at: number; value: Promise<FlowSummary[]> };

  async list(): Promise<{ flows: FlowSummary[] }> {
    const gateway = process.env.MCP_GATEWAY_URL?.replace(/\/+$/, '');
    if (!gateway) {
      return { flows: [] };
    }
    if (!this._cache || Date.now() - this._cache.at > FLOWS_TTL_MS) {
      const value = this.load(gateway);
      this._cache = { at: Date.now(), value };
      // A failed read is not kept: the next request tries again.
      value.catch(() => {
        if (this._cache?.value === value) this._cache = undefined;
      });
    }
    try {
      return { flows: await this._cache.value };
    } catch (err) {
      this.logger.warn(`Could not read the flows: ${String(err)}`);
      return { flows: [] };
    }
  }

  private async load(gateway: string): Promise<FlowSummary[]> {
    const res = await fetch(`${gateway}/flows`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`gateway answered ${res.status}`);
    }
    const body = await res.json();
    const flows: unknown[] = Array.isArray(body?.flows) ? body.flows : [];
    return flows
      .slice(0, MAX_FLOWS)
      .map(toFlowSummary)
      .filter((flow): flow is FlowSummary => !!flow);
  }
}
