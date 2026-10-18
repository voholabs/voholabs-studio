// An empty Brief page shows onboarding's teach step (the prompt to paste and
// what the agent knows), not the old guided onboarding; a written brief, or
// a paid plan, opens the editor.
let access: string | undefined;
let documents: any[] = [];
let onboarding: any;
let user: any;
const mutate = jest.fn();
jest.mock('@gitroom/frontend/components/wallet-locks/wallet.access', () => ({
  useWalletAccess: () => access,
}));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => user,
}));
jest.mock(
  '@gitroom/frontend/components/agent-brief/use.brief.documents',
  () => ({
    BRIEF_DOCUMENTS_KEY: 'brief-documents',
    useBriefDocuments: () => ({ data: { documents }, isLoading: false }),
  })
);
jest.mock(
  '@gitroom/frontend/components/onboarding/use.onboarding.status',
  () => ({
    useOnboardingStatus: () => ({ data: onboarding }),
  })
);
jest.mock('swr', () => ({
  ...jest.requireActual('swr'),
  useSWRConfig: () => ({ mutate }),
}));
jest.mock('@gitroom/frontend/components/agent-brief/agent.brief', () => ({
  AgentBrief: () => <div>Brief editor</div>,
}));
jest.mock('@gitroom/frontend/components/public-api/public.component', () => ({
  ConnectAgentPanel: () => <div>Connect agent panel</div>,
}));
jest.mock(
  '@gitroom/frontend/components/public-api/agent.connection.status',
  () => ({
    useAgentConnection: () => ({ data: { connected: false } }),
  })
);
jest.mock('@gitroom/frontend/components/layout/loading', () => ({
  LoadingComponent: () => <div>Loading</div>,
}));
jest.mock('@gitroom/helpers/utils/use.fire.events', () => ({
  useTrackView: () => undefined,
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => jest.fn(),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, text: string, values: Record<string, any> = {}) =>
      text.replace(/{{(\w+)}}/g, (_m, k) => String(values[k] ?? '')),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { fireEvent, render, screen } from '@testing-library/react';
import { BriefPage } from '@gitroom/frontend/components/agent-brief/brief.page';

const status = (over: Record<string, any> = {}) => ({
  channel: false,
  agent: false,
  brief: {
    done: false,
    documents: [
      { key: 'business', label: 'Business', filled: true },
      { key: 'voice', label: 'Voice', filled: false },
    ],
  },
  credits: { available: 0, claimed: false, skipped: false, eligible: false },
  ...over,
});

beforeEach(() => {
  access = 'payg';
  documents = [];
  onboarding = status();
  user = { publicApi: 'key' };
  mutate.mockReset();
});

describe('BriefPage while the brief is empty', () => {
  it.each(['payg', 'free'])(
    'shows the teach step on the %s plan, not the guided onboarding',
    (plan) => {
      access = plan;
      render(<BriefPage />);
      expect(
        screen.getByText(/Learn my business through Voholabs Studio/)
      ).toBeTruthy();
      expect(screen.getByText('Copy this prompt')).toBeTruthy();
      expect(screen.getByText('What your agent knows')).toBeTruthy();
      expect(screen.getByText('1 / 2')).toBeTruthy();
      expect(screen.queryByText(/first onboarding is free/i)).toBeNull();
      expect(screen.queryByText(/guided onboarding/i)).toBeNull();
      expect(screen.queryByText('Brief editor')).toBeNull();
    }
  );

  it('asks to connect the agent first while none is connected', () => {
    render(<BriefPage />);
    expect(screen.getByText('Connect agent panel')).toBeTruthy();
  });

  it('leaves out the connect panel once an agent is connected', () => {
    onboarding = status({ agent: true });
    render(<BriefPage />);
    expect(screen.queryByText('Connect agent panel')).toBeNull();
    expect(screen.getByText('What your agent knows')).toBeTruthy();
  });

  it('still lets the person write it by hand', () => {
    render(<BriefPage />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Write it myself instead' })
    );
    expect(screen.getByText('Brief editor')).toBeTruthy();
  });

  it('reads the brief again once the agent has filled it', () => {
    onboarding = status({ agent: true, brief: { done: true, documents: [] } });
    render(<BriefPage />);
    expect(mutate).toHaveBeenCalledWith('brief-documents');
  });
});

describe('BriefPage with a brief, or on a paid plan', () => {
  it('opens the editor once something is written', () => {
    documents = [{ category: 'foundation', key: 'business' }];
    render(<BriefPage />);
    expect(screen.getByText('Brief editor')).toBeTruthy();
  });

  it('a member, who holds no API key for an agent, gets the editor', () => {
    user = {};
    render(<BriefPage />);
    expect(screen.getByText('Brief editor')).toBeTruthy();
    expect(screen.queryByText('What your agent knows')).toBeNull();
  });

  it('a paid plan keeps the editor, even when empty', () => {
    access = 'plan';
    render(<BriefPage />);
    expect(screen.getByText('Brief editor')).toBeTruthy();
  });
});
