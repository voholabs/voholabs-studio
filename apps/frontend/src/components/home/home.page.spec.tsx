// Home shows the next scheduled posts (soonest first, future only), or says
// why there are none: no channel yet, or nothing scheduled.
let integrations: any[] = [];
let upcoming: any;
const refetch = jest.fn();
jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration.list',
  () => ({
    useIntegrationList: () => ({ data: integrations, isLoading: false }),
  })
);
jest.mock('@gitroom/frontend/components/home/home.hooks', () => ({
  useUpcomingPosts: () => ({
    data: upcoming,
    isLoading: false,
    mutate: refetch,
  }),
}));
jest.mock('@gitroom/frontend/components/flows/flows.hooks', () => ({
  useFlows: () => ({ data: [], isLoading: false }),
  useUserFlows: () => ({
    data: { locked: false, flows: [] },
    mutate: jest.fn(),
  }),
}));
jest.mock('@gitroom/frontend/components/flows/flows.mine', () => ({
  MyFlowsSection: () => null,
  useOpenFlowEditor: () => jest.fn(),
}));
jest.mock('@gitroom/frontend/components/flows/flows.card', () => ({
  FlowCard: () => null,
  usePreviewPolicy: () => ({ hover: false, scroll: false, autoplay: false }),
}));
jest.mock('@gitroom/frontend/components/flows/flows.drawer', () => ({
  FlowDrawer: () => null,
}));
jest.mock('@gitroom/frontend/components/flows/flows.page', () => ({
  sortFlows: (flows: any[]) => flows,
  relatedFlows: () => [],
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, text: string) => text,
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { render, screen } from '@testing-library/react';
import { HomePage } from '@gitroom/frontend/components/home/home.page';

const channel = {
  id: 'c1',
  providerIdentifier: 'x',
  name: 'Voho on X',
  picture: null,
};

const post = (id: string, publishDate: string, content: string) => ({
  id,
  content,
  publishDate,
  group: id,
  integration: channel,
});

describe('HomePage next post', () => {
  beforeEach(() => {
    integrations = [{ id: 'c1' }];
    upcoming = { posts: [], total: 0 };
    refetch.mockClear();
  });

  it('asks for a channel when none is connected', () => {
    integrations = [];
    render(<HomePage />);
    expect(screen.getByText('No channels connected yet')).toBeTruthy();
    expect(
      screen
        .getByText('Go to the calendar to add channels')
        .getAttribute('href')
    ).toBe('/launches');
  });

  it('says nothing is scheduled and links to the calendar', () => {
    render(<HomePage />);
    expect(screen.getByText('Nothing scheduled yet')).toBeTruthy();
    expect(refetch).not.toHaveBeenCalled();
    expect(screen.getByText('Open the calendar').getAttribute('href')).toBe(
      '/launches'
    );
  });

  it('shows the soonest future post first, as text, linked to its day', () => {
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const later = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();
    const gone = new Date(Date.now() - 60 * 1000).toISOString();
    upcoming = {
      posts: [
        post('p0', gone, '<p>Already out</p>'),
        post('p1', soon, '<p>Hello <strong>world</strong></p>'),
        post('p2', later, '<p>Tomorrow</p>'),
      ],
      total: 3,
    };
    render(<HomePage />);
    expect(screen.queryByText('Already out')).toBeNull();
    // One went out since the list loaded: load the ones after it.
    expect(refetch).toHaveBeenCalled();
    const first = screen.getByText('Hello world').closest('a');
    expect(first?.textContent).toContain('Next up');
    expect(first?.getAttribute('href')).toMatch(
      /^\/launches\?startDate=\d{4}-\d{2}-\d{2}&endDate=\d{4}-\d{2}-\d{2}&display=day$/
    );
    expect(
      screen.getByText('Tomorrow').closest('a')?.textContent
    ).not.toContain('Next up');
  });
});
