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
export const paidOnly = (context: any, feature: string) => {
  try {
    const organization = JSON.parse(
      (context?.requestContext as any)?.get('organization') as string
    );
    return hasAccess(organization) ? null : paidFeatureMessage(feature);
  } catch (err) {
    return paidFeatureMessage(feature);
  }
};
