// The onboarding steps: every step can be skipped, and a step passed without
// being done shows as skipped, never with the tick of a finished one.
let fetched: Record<string, any> = {};
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => async (path: string) => ({
    ok: true,
    json: async () => fetched[path],
  }),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, text: string, values: Record<string, any> = {}) =>
      text.replace(/{{(\w+)}}/g, (_m, k) => String(values[k] ?? '')),
}));
jest.mock('@gitroom/helpers/utils/use.fire.events', () => ({
  useFireEvents: () => jest.fn(),
  useTrackView: () => undefined,
}));
jest.mock('@gitroom/frontend/components/wallet/wallet.hooks', () => ({
  useRefreshWallet: () => jest.fn(),
}));
jest.mock('@gitroom/frontend/components/plus/plus.hooks', () => ({
  usePlusPlan: () => ({ data: undefined, mutate: jest.fn() }),
}));
jest.mock('@gitroom/frontend/components/plus/plus.offer', () => ({
  EarlyBirdOfferBox: () => null,
}));
jest.mock(
  '@gitroom/frontend/components/launches/add.provider.component',
  () => ({
    AddProviderComponent: () => null,
  })
);
jest.mock('@gitroom/frontend/components/public-api/public.component', () => ({
  ConnectAgentPanel: () => null,
}));
jest.mock(
  '@gitroom/frontend/components/public-api/agent.connection.status',
  () => ({
    useAgentConnection: () => ({ data: { connected: false } }),
  })
);
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ closeAll: jest.fn() }),
}));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => ({}),
}));
jest.mock('@gitroom/frontend/components/wallet-locks/wallet.access', () => ({
  useWalletAccess: () => 'free',
}));
jest.mock('@gitroom/frontend/components/layout/top.menu', () => ({
  SUPPORT_URL: '#',
}));
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: jest.fn() }),
}));
jest.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: jest.fn(),
}));
jest.mock('@gitroom/react/helpers/safe.image', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@gitroom/helpers/utils/utm.saver', () => ({
  stripSensitiveParams: (value: string) => value,
}));
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  OnboardingStep1,
  OnboardingStepper,
} from '@gitroom/frontend/components/onboarding/onboarding.modal';

const status = (over: Record<string, any> = {}) => ({
  channel: false,
  agent: false,
  brief: { done: false, documents: [] },
  credits: { available: 0, claimed: false, skipped: false, eligible: false },
  ...over,
});

const stepButton = (name: RegExp) => screen.getByRole('button', { name });

describe('OnboardingStepper', () => {
  it('marks passed steps that were not done as skipped, with no tick', () => {
    render(
      <OnboardingStepper
        step="start"
        onGoTo={jest.fn()}
        withBrief={true}
        status={status() as any}
      />
    );
    for (const name of [
      /Connect channels/,
      /Connect your agent/,
      /Teach your agent/,
    ]) {
      const button = stepButton(name);
      expect(button.textContent).toContain('Skipped');
      expect(button.querySelector('svg')).toBeNull();
    }
  });

  it('ticks only what the server says is done', () => {
    render(
      <OnboardingStepper
        step="start"
        onGoTo={jest.fn()}
        withBrief={true}
        status={status({ channel: true, agent: true }) as any}
      />
    );
    expect(stepButton(/Connect channels/).querySelector('svg')).not.toBeNull();
    expect(stepButton(/Connect your agent/).textContent).not.toContain(
      'Skipped'
    );
    expect(stepButton(/Teach your agent/).textContent).toContain('Skipped');
    expect(stepButton(/Teach your agent/).querySelector('svg')).toBeNull();
  });

  it('a skipped step can be opened again', () => {
    const onGoTo = jest.fn();
    render(
      <OnboardingStepper
        step="brief"
        onGoTo={onGoTo}
        withBrief={true}
        status={status() as any}
      />
    );
    fireEvent.click(stepButton(/Connect channels/));
    expect(onGoTo).toHaveBeenCalledWith('channels');
  });
});

describe('OnboardingStep1', () => {
  beforeEach(() => {
    fetched = {
      '/integrations/list': { integrations: [] },
      '/integrations': { social: [], article: [] },
    };
  });

  // Lets the channel lists load, so nothing updates after the test.
  const settle = () => act(async () => undefined);

  it('can be skipped without a channel', async () => {
    const onNext = jest.fn();
    render(
      <OnboardingStep1
        onNext={onNext}
        onSkip={jest.fn()}
        hasNext={true}
        required={true}
      />
    );
    await settle();
    const next = stepButton(/Next: connect your agent/);
    expect((next as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(stepButton(/Skip for now/));
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(next);
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Connect at least one channel/)).toBeNull();
  });

  it('a member finishes without a channel', async () => {
    const onNext = jest.fn();
    render(
      <OnboardingStep1 onNext={onNext} onSkip={jest.fn()} required={true} />
    );
    await settle();
    expect(screen.queryByRole('button', { name: /Skip for now/ })).toBeNull();
    fireEvent.click(stepButton(/Start without channels/));
    expect(onNext).toHaveBeenCalled();
  });
});
