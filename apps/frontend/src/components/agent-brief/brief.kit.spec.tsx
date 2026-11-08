// The brand kit on Branding & assets: what the notes suggest, and what the
// page sends. Nothing invalid is ever sent, so a half-typed colour or font
// cannot fail the save of the rest of the document.
jest.mock('@gitroom/frontend/components/wallet-locks/wallet.access', () => ({
  useWalletAccess: () => 'wallet',
}));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => ({ orgId: 'org-1' }),
}));
jest.mock('@gitroom/frontend/components/media/media.component', () => ({
  showMediaBox: jest.fn(),
}));
jest.mock('@gitroom/frontend/components/wallet/wallet.bridge', () => ({
  WALLET_INLINE_REQUEST: {},
  openTopUpIfWalletRefused: jest.fn(async () => undefined),
}));
jest.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ backendUrl: 'https://studio.test' }),
}));
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: jest.fn() }),
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

import { fireEvent, render, screen } from '@testing-library/react';
import {
  BriefBrandKit,
  suggestKit,
} from '@gitroom/frontend/components/agent-brief/brief.kit';

const block = (heading: string, body: string) => ({
  id: heading,
  heading,
  body,
});

const NOTES = [
  block(
    'Colours',
    'Navy #0e1a2b is the brand, lime #C6F432 for highlights, on #FFF with #111111 text.'
  ),
  block('Typography', 'Playfair Display for headings, Inter for body text.'),
  block('Imagery', 'Warm candid photos of real customers. No stock.'),
];
const FILES = [
  { id: 'a1', name: 'logo.png', url: '/uploads/logo.png' },
  { id: 'a2', name: 'logo-white.png', url: '/uploads/logo-white.png' },
  { id: 'a3', name: 'favicon.png', url: '/uploads/favicon.png' },
  { id: 'a4', name: 'deck.pdf', url: '/uploads/deck.pdf', note: 'logo guide' },
];

describe('suggestKit', () => {
  it('reads colours by role, Google fonts, the imagery line and the logos', () => {
    expect(suggestKit(NOTES, FILES)).toEqual({
      colors: [
        { role: 'primary', hex: '#0E1A2B' },
        { role: 'accent', hex: '#C6F432' },
        { role: 'background', hex: '#FFFFFF' },
        { role: 'text', hex: '#111111' },
      ],
      fonts: [
        { role: 'headline', family: 'Playfair Display' },
        { role: 'body', family: 'Inter' },
      ],
      logos: [
        { variant: 'light', url: '/uploads/logo.png' },
        { variant: 'dark', url: '/uploads/logo-white.png' },
        { variant: 'icon', url: '/uploads/favicon.png' },
      ],
      imagery: 'Warm candid photos of real customers.',
    });
  });

  it('gives a single colour the primary role and skips non-Google fonts', () => {
    expect(
      suggestKit(
        [
          block('Colour', 'Our orange is #F60.'),
          block('Fonts', 'Body: Helvetica Neue. Headings: Fraunces.'),
        ],
        []
      )
    ).toEqual({
      colors: [{ role: 'primary', hex: '#FF6600' }],
      fonts: [{ role: 'headline', family: 'Fraunces' }],
    });
  });

  it('finds nothing in notes without kit values', () => {
    expect(suggestKit([block('Tone', 'Friendly and short')], [])).toEqual({});
  });
});

describe('BriefBrandKit', () => {
  beforeEach(() => localStorage.clear());

  it('offers the values from the notes and writes them only on "Use these"', () => {
    const onChange = jest.fn();
    render(<BriefBrandKit blocks={NOTES} assets={FILES} onChange={onChange} />);
    expect(screen.getByText('Fill these from your notes')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Use these'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(suggestKit(NOTES, FILES));
    expect(screen.queryByText('Fill these from your notes')).toBeNull();
  });

  it('remembers "Not now" for this workspace and writes nothing', () => {
    const onChange = jest.fn();
    const { unmount } = render(
      <BriefBrandKit blocks={NOTES} assets={FILES} onChange={onChange} />
    );
    fireEvent.click(screen.getByText('Not now'));
    expect(screen.queryByText('Fill these from your notes')).toBeNull();
    expect(localStorage.getItem('brief-kit-suggestion-dismissed:org-1')).toBe(
      '1'
    );
    unmount();
    render(<BriefBrandKit blocks={NOTES} assets={FILES} onChange={onChange} />);
    expect(screen.queryByText('Fill these from your notes')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('suggests nothing once the kit holds something', () => {
    render(
      <BriefBrandKit
        kit={{ imagery: 'Bold flat colour' }}
        blocks={NOTES}
        assets={FILES}
        onChange={jest.fn()}
      />
    );
    expect(screen.queryByText('Fill these from your notes')).toBeNull();
  });

  it('sends a colour once it is six hex digits, uppercase, and never a half-typed one', () => {
    const onChange = jest.fn();
    render(<BriefBrandKit blocks={[]} assets={[]} onChange={onChange} />);
    const hex = screen.getByLabelText('Primary hex');

    fireEvent.change(hex, { target: { value: '#12G' } });
    fireEvent.blur(hex);
    expect(onChange).not.toHaveBeenCalled();
    expect(hex.className).toContain('border-danger');

    fireEvent.change(hex, { target: { value: '#0e1a2b' } });
    expect(onChange).toHaveBeenLastCalledWith({
      colors: [{ role: 'primary', hex: '#0E1A2B' }],
      fonts: [],
      logos: [],
      imagery: '',
    });
  });

  it('expands a three-digit colour on blur', () => {
    const onChange = jest.fn();
    render(<BriefBrandKit blocks={[]} assets={[]} onChange={onChange} />);
    const hex = screen.getByLabelText('Accent hex');
    fireEvent.change(hex, { target: { value: 'f60' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(hex);
    expect(onChange.mock.calls[0][0].colors).toEqual([
      { role: 'accent', hex: '#FF6600' },
    ]);
  });

  it('sends a font only when it is a Google Fonts family, spelled as Google does', () => {
    const onChange = jest.fn();
    render(<BriefBrandKit blocks={[]} assets={[]} onChange={onChange} />);
    const headline = screen.getByLabelText('Headline');

    fireEvent.change(headline, { target: { value: 'Helvetica Neue' } });
    fireEvent.blur(headline);
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Not saved: "Helvetica Neue" is not a Google Fonts family. Pick one from fonts.google.com, for example "Inter" or "Playfair Display".'
      )
    ).toBeTruthy();

    fireEvent.change(headline, { target: { value: 'playfair display' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fonts: [{ role: 'headline', family: 'Playfair Display' }],
      })
    );
  });

  it('sends the whole kit on every change, so a cleared field is cleared', () => {
    const onChange = jest.fn();
    render(
      <BriefBrandKit
        kit={{
          colors: [{ role: 'primary', hex: '#0E1A2B' }],
          imagery: 'Bold',
        }}
        blocks={[]}
        assets={[]}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByLabelText('Imagery'), {
      target: { value: '' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      colors: [{ role: 'primary', hex: '#0E1A2B' }],
      fonts: [],
      logos: [],
      imagery: '',
    });
  });
});
