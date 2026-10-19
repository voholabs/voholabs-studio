import {
  FLOWS_TTL_MS,
  FlowsService,
  toFlowSummary,
} from '@gitroom/nestjs-libraries/flows/flows.service';

describe('toFlowSummary', () => {
  it('keeps the fields the page reads and drops the rest', () => {
    expect(
      toFlowSummary({
        id: 'whiteboard-explainer',
        title: '  Whiteboard explainer  ',
        summary: 'A narrated whiteboard video.',
        exampleVideo: 'https://cdn.example.com/a.mp4',
        exampleLink: 'https://example.com/blog/a',
        poster: 'https://cdn.example.com/a.jpg',
        category: 'video',
        cost: 'About 10-15 credits',
        costEstimate: '~10-15 credits',
        free: true,
        paidResearch: true,
        featured: false,
        aspect: '16:9',
        inputs: ['A topic', ' ', 42],
        foundation: 'internal notes',
        requires: ['wallet'],
      })
    ).toEqual({
      id: 'whiteboard-explainer',
      title: 'Whiteboard explainer',
      summary: 'A narrated whiteboard video.',
      exampleVideo: 'https://cdn.example.com/a.mp4',
      exampleLink: 'https://example.com/blog/a',
      poster: 'https://cdn.example.com/a.jpg',
      category: 'video',
      cost: 'About 10-15 credits',
      costEstimate: '~10-15 credits',
      free: true,
      paidResearch: true,
      aspect: '16:9',
      inputs: ['A topic'],
    });
  });

  it('only keeps https media links', () => {
    const flow = toFlowSummary({
      id: 'a',
      title: 'A',
      exampleVideo: 'javascript:alert(1)',
      exampleLink: 'javascript:alert(1)',
      poster: 'http://cdn.example.com/a.jpg',
    });
    expect(flow?.exampleVideo).toBeUndefined();
    expect(flow?.exampleLink).toBeUndefined();
    expect(flow?.poster).toBeUndefined();
  });

  it('keeps a sample image set of https links, at most twelve', () => {
    const many = Array.from(
      { length: 15 },
      (_, i) => `https://cdn.example.com/s${i}.png`
    );
    expect(
      toFlowSummary({
        id: 'a',
        title: 'A',
        aspect: '4:5',
        exampleImages: [
          'https://cdn.example.com/a.jpg',
          'javascript:alert(1)',
          'http://cdn.example.com/b.png',
          42,
          'https://cdn.example.com/c.png',
        ],
      })
    ).toMatchObject({
      aspect: '4:5',
      exampleImages: [
        'https://cdn.example.com/a.jpg',
        'https://cdn.example.com/c.png',
      ],
    });
    expect(
      toFlowSummary({ id: 'a', title: 'A', exampleImages: many })?.exampleImages
    ).toEqual(many.slice(0, 12));
    expect(
      toFlowSummary({
        id: 'a',
        title: 'A',
        exampleImages: ['https://cdn.example.com/a.jpg'],
      })?.exampleImages
    ).toBeUndefined();
    expect(
      toFlowSummary({ id: 'a', title: 'A', exampleImages: 'https://x.y/a.png' })
        ?.exampleImages
    ).toBeUndefined();
  });

  it('drops unknown categories and aspects', () => {
    const flow = toFlowSummary({
      id: 'a',
      title: 'A',
      category: 'audio',
      aspect: '4:3',
    });
    expect(flow?.category).toBeUndefined();
    expect(flow?.aspect).toBeUndefined();
  });

  it('caps long text and long lists', () => {
    const flow = toFlowSummary({
      id: 'a',
      title: 'x'.repeat(500),
      tags: Array.from({ length: 50 }, (_, i) => `tag${i}`),
    });
    expect(flow?.title).toHaveLength(160);
    expect(
      toFlowSummary({ id: 'a', title: 'A', costEstimate: 'x'.repeat(500) })
        ?.costEstimate
    ).toHaveLength(60);
    expect(flow?.tags).toHaveLength(20);
  });

  it('refuses a flow without a slug id or a title', () => {
    expect(toFlowSummary({ title: 'A' })).toBeNull();
    expect(toFlowSummary({ id: '../x', title: 'A' })).toBeNull();
    expect(toFlowSummary({ id: 'a', title: '  ' })).toBeNull();
    expect(toFlowSummary(null)).toBeNull();
  });
});

// The catalog is read from the gateway at most once a minute.
describe('FlowsService.list', () => {
  const env = process.env.MCP_GATEWAY_URL;
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.MCP_GATEWAY_URL = 'http://gateway.test/';
    fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ flows: [{ id: 'a', title: 'A' }] }),
    }));
    global.fetch = fetchMock as any;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
    if (env === undefined) {
      delete process.env.MCP_GATEWAY_URL;
    } else {
      process.env.MCP_GATEWAY_URL = env;
    }
  });

  it('serves the cached catalog within the TTL and reads it again after', async () => {
    const service = new FlowsService();
    const first = await service.list();
    expect(first).toEqual({ flows: [{ id: 'a', title: 'A', summary: '' }] });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://gateway.test/flows',
      expect.anything()
    );

    jest.advanceTimersByTime(FLOWS_TTL_MS - 1);
    expect(await service.list()).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2);
    await service.list();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('answers no flows on a failed read and tries again on the next request', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502 });
    const service = new FlowsService();
    expect(await service.list()).toEqual({ flows: [] });
    expect(await service.list()).toEqual({
      flows: [{ id: 'a', title: 'A', summary: '' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('answers no flows without a gateway', async () => {
    delete process.env.MCP_GATEWAY_URL;
    expect(await new FlowsService().list()).toEqual({ flows: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
