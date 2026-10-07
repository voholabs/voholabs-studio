import {
  canFinishConnect,
  ConnectSessionLookups,
  parseConnectState,
  serializeConnectState,
} from '@gitroom/nestjs-libraries/integrations/connect.state';

describe('parseConnectState', () => {
  it('reads a plain organization id written before the record existed', () => {
    expect(parseConnectState('org-1')).toEqual({ orgId: 'org-1', via: 'legacy' });
  });

  it('round-trips a session record', () => {
    const raw = serializeConnectState({
      orgId: 'org-1',
      via: 'session',
      userId: 'u1',
    });
    expect(parseConnectState(raw)).toEqual({
      orgId: 'org-1',
      via: 'session',
      userId: 'u1',
    });
  });

  it('keeps the connected channel of the page step, legacy ones included', () => {
    const raw = serializeConnectState({
      orgId: 'org-1',
      via: 'legacy',
      integrationId: 'i1',
    });
    expect(parseConnectState(raw)).toEqual({
      orgId: 'org-1',
      via: 'legacy',
      integrationId: 'i1',
    });
  });

  it('refuses what it cannot read', () => {
    expect(parseConnectState(null)).toBeNull();
    expect(parseConnectState('')).toBeNull();
    expect(parseConnectState('{broken')).toBeNull();
    expect(parseConnectState(JSON.stringify({ orgId: 'o', via: 'other' }))).toBeNull();
    expect(parseConnectState(JSON.stringify({ via: 'api' }))).toBeNull();
  });
});

describe('canFinishConnect', () => {
  const lookups = (
    user: any,
    orgs: any[] = [{ id: 'org-1', users: [{ disabled: false }] }]
  ): ConnectSessionLookups => ({
    verifyJWT: jest.fn((token: string) => {
      if (token !== 'good') {
        throw new Error('bad signature');
      }
      return { id: 'u1' };
    }),
    getUserById: jest.fn(async () => user),
    getOrgsByUserId: jest.fn(async () => orgs),
  });

  const member = { id: 'u1', activated: true, isSuperAdmin: false };
  const session = { orgId: 'org-1', via: 'session' as const, userId: 'u1' };

  it('asks nothing of API and legacy starts', async () => {
    const l = lookups(null);
    expect(await canFinishConnect({ orgId: 'org-1', via: 'api' }, undefined, l)).toBe(true);
    expect(await canFinishConnect({ orgId: 'org-1', via: 'legacy' }, undefined, l)).toBe(true);
    expect(l.getUserById).not.toHaveBeenCalled();
  });

  it('lets a signed-in member of the organization finish', async () => {
    expect(await canFinishConnect(session, 'good', lookups(member))).toBe(true);
  });

  it('turns away a request without a session', async () => {
    expect(await canFinishConnect(session, undefined, lookups(member))).toBe(false);
  });

  it('turns away a token that does not verify', async () => {
    expect(await canFinishConnect(session, 'forged', lookups(member))).toBe(false);
  });

  it('turns away someone from another organization', async () => {
    expect(
      await canFinishConnect(
        session,
        'good',
        lookups(member, [{ id: 'org-2', users: [{ disabled: false }] }])
      )
    ).toBe(false);
  });

  it('turns away a disabled member and an inactive user', async () => {
    expect(
      await canFinishConnect(
        session,
        'good',
        lookups(member, [{ id: 'org-1', users: [{ disabled: true }] }])
      )
    ).toBe(false);
    expect(
      await canFinishConnect(session, 'good', lookups({ ...member, activated: false }))
    ).toBe(false);
  });

  it('lets a super admin finish what they started while impersonating', async () => {
    expect(
      await canFinishConnect(
        session,
        'good',
        lookups({ ...member, isSuperAdmin: true }, [])
      )
    ).toBe(true);
  });
});
