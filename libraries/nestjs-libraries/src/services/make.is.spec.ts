import {
  makeCodeVerifier,
  makeId,
  makeState,
} from '@gitroom/nestjs-libraries/services/make.is';

describe('makeId', () => {
  it('keeps the same length and alphabet', () => {
    for (const length of [0, 1, 5, 10, 20, 40, 48, 500]) {
      const id = makeId(length);
      expect(id).toHaveLength(length);
      expect(id).toMatch(/^[A-Za-z0-9]*$/);
    }
  });

  it('draws from the Web Crypto source, not Math.random', () => {
    const random = jest.spyOn(Math, 'random');
    const values = jest.spyOn(globalThis.crypto, 'getRandomValues');
    makeId(40);
    expect(random).not.toHaveBeenCalled();
    expect(values).toHaveBeenCalled();
    random.mockRestore();
    values.mockRestore();
  });

  it('falls back to Math.random where there is no Web Crypto (workflow sandbox)', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
    });
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      expect(makeId(4)).toBe('AAAA');
    } finally {
      random.mockRestore();
      Object.defineProperty(globalThis, 'crypto', original!);
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => makeId(20)));
    expect(seen.size).toBe(2000);
  });

  it('spreads evenly over the alphabet', () => {
    const counts: Record<string, number> = {};
    for (const ch of makeId(62 * 2000)) {
      counts[ch] = (counts[ch] || 0) + 1;
    }
    expect(Object.keys(counts)).toHaveLength(62);
    for (const n of Object.values(counts)) {
      expect(n).toBeGreaterThan(1600);
      expect(n).toBeLessThan(2400);
    }
  });
});

describe('connect helpers', () => {
  it('makes a 32 character state', () => {
    expect(makeState()).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it('makes a PKCE verifier inside RFC 7636 bounds', () => {
    const verifier = makeCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });
});
