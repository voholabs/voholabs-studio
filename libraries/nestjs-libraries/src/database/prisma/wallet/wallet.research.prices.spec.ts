// The research data on the Prices page: the gateway's groups and source
// costs, priced with the research price row.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service',
  () => ({ WalletService: class {} })
);

import {
  RESEARCH_ACTION_KEY,
  WalletResearchPricesService,
  toResearchGroup,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.research.prices.service';

const GROUPS = [
  {
    id: 'reviews',
    title: 'Reviews',
    summary: 'What customers say on review sites',
    runs: 2,
    lowUsd: 0.03,
    highUsd: 0.05,
  },
  { id: 'Bad id!', title: 'Dropped', lowUsd: 0, highUsd: 1 },
];

const ROW = { key: RESEARCH_ACTION_KEY, costMicros: 1_000_000 };

// The wallet standing in: a price row at cost x 1.5, 20 credits a dollar,
// in hundredths of a credit, as WalletService.usagePrice prices it.
const build = (row: any = ROW) => {
  const wallet = {
    price: jest.fn(async (key: string) =>
      row && key === RESEARCH_ACTION_KEY
        ? { action: row, price: 3000 }
        : undefined
    ),
    usagePrice: jest.fn(async (_action: any, units: number) =>
      Math.round(units * 1.5 * 20 * 100)
    ),
  };
  return { wallet, service: new WalletResearchPricesService(wallet as any) };
};

const answer = (body: unknown, ok = true) =>
  jest.fn(async () => ({ ok, status: ok ? 200 : 502, json: async () => body }));

describe('toResearchGroup', () => {
  it('keeps the fields the page reads and drops the rest', () => {
    expect(
      toResearchGroup({ ...GROUPS[0], title: '  Reviews ', route: 'secret' })
    ).toEqual(GROUPS[0]);
  });

  it('drops a group without a slug id, a title or a cost range', () => {
    expect(toResearchGroup(GROUPS[1])).toBeNull();
    expect(toResearchGroup({ id: 'a', lowUsd: 0, highUsd: 1 })).toBeNull();
    expect(
      toResearchGroup({ id: 'a', title: 'A', lowUsd: 2, highUsd: 1 })
    ).toBeNull();
    expect(
      toResearchGroup({ id: 'a', title: 'A', lowUsd: -1, highUsd: 1 })
    ).toBeNull();
    expect(
      toResearchGroup({ id: 'a', title: 'A', lowUsd: 'x', highUsd: 1 })
    ).toBeNull();
  });
});

describe('WalletResearchPricesService', () => {
  const env = process.env.MCP_GATEWAY_URL;
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.MCP_GATEWAY_URL = 'https://gateway.example.com/';
  });
  afterEach(() => {
    process.env.MCP_GATEWAY_URL = env;
    global.fetch = realFetch;
  });

  it('prices each group from the research row, cheapest and dearest run', async () => {
    global.fetch = answer({ groups: GROUPS }) as any;
    const { service, wallet } = build();
    expect(await service.prices()).toEqual({
      groups: [
        {
          id: 'reviews',
          title: 'Reviews',
          summary: 'What customers say on review sites',
          runs: 2,
          low: 90,
          high: 150,
        },
      ],
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://gateway.example.com/data',
      expect.anything()
    );
    expect(wallet.usagePrice).toHaveBeenCalledWith(ROW, 0.03);
    expect(wallet.usagePrice).toHaveBeenCalledWith(ROW, 0.05);
  });

  it('lists nothing without an active research row, and asks no gateway', async () => {
    global.fetch = answer({ groups: GROUPS }) as any;
    const { service } = build(null);
    expect(await service.prices()).toEqual({ groups: [] });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('lists nothing without a gateway, or when it fails', async () => {
    delete process.env.MCP_GATEWAY_URL;
    expect(await build().service.prices()).toEqual({ groups: [] });
    process.env.MCP_GATEWAY_URL = 'https://gateway.example.com';
    global.fetch = answer({}, false) as any;
    expect(await build().service.prices()).toEqual({ groups: [] });
    global.fetch = jest.fn(async () => {
      throw new Error('timeout');
    }) as any;
    expect(await build().service.prices()).toEqual({ groups: [] });
  });
});
