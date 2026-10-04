import {
  creditsText,
  freeAllowance,
  postCost,
  postHasLink,
  pricingModel,
  toCredits,
  walletForecast,
} from '@gitroom/nestjs-libraries/chat/tools/wallet.shared';
import { xPostActionKey } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.x';

describe('xPostActionKey (X link rule)', () => {
  it('charges a bare domain at the link rate', () => {
    expect(xPostActionKey('read more at example.com')).toBe('x.post_link');
  });

  it('charges a full URL at the link rate', () => {
    expect(xPostActionKey('https://a.com')).toBe('x.post_link');
  });

  it('charges plain text as a plain post', () => {
    expect(xPostActionKey('just some words, no links here.')).toBe('x.post');
  });

  it('charges an empty or missing text as a plain post', () => {
    expect(xPostActionKey('')).toBe('x.post');
    expect(xPostActionKey(undefined as any)).toBe('x.post');
  });
});

describe('postHasLink', () => {
  it('sees a URL inside HTML content', () => {
    expect(postHasLink('<p>Visit <a href="https://a.com">a.com</a></p>')).toBe(
      true
    );
  });

  it('sees a bare domain inside HTML content', () => {
    expect(postHasLink('<p>Read example.com today</p>')).toBe(true);
  });

  it('counts a (post:<id>) reference as a link, since it becomes one at publish', () => {
    expect(postHasLink('<p>Follow-up to (post:abc123)</p>')).toBe(true);
  });

  it('is false for plain text and empty content', () => {
    expect(postHasLink('<p>Hello there</p>')).toBe(false);
    expect(postHasLink('')).toBe(false);
  });
});

describe('postCost', () => {
  const wallet = (prices: Record<string, number>) =>
    ({
      price: jest.fn(async (key: string) =>
        key in prices ? { price: prices[key] } : undefined
      ),
    } as any);

  it('adds up every tweet of a thread at its own rate', async () => {
    const w = wallet({ 'x.post': 225, 'x.post_link': 3000 });
    expect(
      await postCost(w, 'x', [
        '<p>one</p>',
        '<p>two example.com</p>',
        '<p>three</p>',
      ])
    ).toBe(3450);
    expect(w.price).toHaveBeenCalledWith('x.post_link');
  });

  it('uses the provider part of a channel identifier', async () => {
    const w = wallet({ 'x.post': 225 });
    expect(await postCost(w, 'X-Premium', ['<p>hi</p>'])).toBe(225);
  });

  it('is undefined when a price row is missing, never a guess', async () => {
    const w = wallet({ 'x.post': 225 });
    expect(
      await postCost(w, 'x', ['<p>hi</p>', '<p>go a.com</p>'])
    ).toBeUndefined();
  });
});

describe('walletForecast', () => {
  it('is undefined when the service has no forecast', async () => {
    expect(await walletForecast({} as any, 'o')).toBeUndefined();
  });

  it('is undefined when the forecast throws', async () => {
    const wallet = {
      forecast: jest.fn(async () => {
        throw new Error('db down');
      }),
    } as any;
    expect(await walletForecast(wallet, 'o')).toBeUndefined();
  });

  it('keeps needed and short, and defaults the window to 48 hours', async () => {
    const wallet = {
      forecast: jest.fn(async () => ({ needed: 450, short: 1 })),
    } as any;
    expect(await walletForecast(wallet, 'o')).toEqual({
      windowHours: 48,
      needed: 450,
      short: true,
    });
  });
});

describe('credit and price text', () => {
  const action = (over: Record<string, any> = {}) =>
    ({
      key: 'k',
      provider: 'p',
      category: null,
      name: 'n',
      description: null,
      unit: 'post',
      freeUnits: null,
      freePeriod: null,
      billing: 'PER_USE',
      requiresTopUp: false,
      price: 225,
      ...over,
    } as any);

  it('formats hundredths as credits', () => {
    expect(toCredits(225)).toBe(2.25);
    expect(creditsText(225)).toBe('2.25 credits');
    expect(creditsText(5000)).toBe('50.00 credits');
  });

  it('names the pricing model from the billing field', () => {
    expect(pricingModel(action())).toBe('per post');
    expect(pricingModel(action({ billing: 'MONTHLY', unit: 'gb' }))).toBe(
      'per GB / month'
    );
    expect(pricingModel(action({ billing: 'UNLOCK' }))).toBe('Free');
  });

  it('describes the free allowance from the row', () => {
    expect(freeAllowance(action())).toBe('None');
    expect(
      freeAllowance(
        action({ freeUnits: 1, freePeriod: 'ONCE', requiresTopUp: true })
      )
    ).toBe('First time free, unlocks after first top up');
    expect(
      freeAllowance(action({ freeUnits: 2, freePeriod: 'MONTH', unit: 'gb' }))
    ).toBe('2 GB free each month');
    expect(freeAllowance(action({ billing: 'UNLOCK' }))).toBe('Unlimited use');
  });
});
