import { getAuth } from '@gitroom/nestjs-libraries/chat/async.storage';
import {
  hasAccess,
  paidFeatureMessage,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';

export const checkAuth = (
  inputData: any,
  context: any
) => {
  const auth = getAuth();
  const authInfo = context?.mcp?.extra?.authInfo || auth;
  if (authInfo && context?.requestContext) {
    (context.requestContext as any).set(
      'organization',
      JSON.stringify(authInfo)
    );
    (context.requestContext as any).set('ui', 'false');
  }
};

// The tool map is built once at boot and cannot vary per organization, so a
// paid tool stays listed for everybody and refuses when a free organization
// calls it. Call it right after checkAuth, which is what puts the organization
// into the request context.
//
// opensWithWallet: a pay-as-you-go workspace (one that has topped up its
// wallet) may use it too. startMcp marks the organization with payAsYouGo.
export const paidOnly = (
  context: any,
  feature: string,
  opensWithWallet = false
) => {
  const locked = opensWithWallet
    ? `${feature} opens after your first wallet top-up.`
    : paidFeatureMessage(feature);
  try {
    const organization = JSON.parse(
      (context?.requestContext as any)?.get('organization') as string
    );
    return hasAccess(organization) ||
      (opensWithWallet && organization?.payAsYouGo)
      ? null
      : locked;
  } catch (err) {
    return locked;
  }
};
