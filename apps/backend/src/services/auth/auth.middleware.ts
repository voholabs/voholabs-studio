import {
  needsTerms,
  termsOpenPaths,
} from '@gitroom/nestjs-libraries/database/prisma/users/terms';
import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { User } from '@prisma/client';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { HttpForbiddenException } from '@gitroom/nestjs-libraries/services/exception.filter';
import { isAllowedBrowserRequest } from '@gitroom/helpers/auth/request.origin';
import {
  checkSessionPayload,
  isRevokedSession,
  signSessionToken,
} from '@gitroom/helpers/auth/session.token';
import {
  clearAuthCookie,
  setAuthCookie,
} from '@gitroom/backend/services/auth/auth.cookie';
import {
  needsOnboarding,
  onboardingOpenPaths,
} from '@gitroom/nestjs-libraries/database/prisma/users/onboarding';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

export const removeAuth = (res: Response) => {
  clearAuthCookie(res);
  res.header('logout', 'true');
};

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private _organizationService: OrganizationService,
    private _userService: UsersService
  ) {}
  async use(req: Request, res: Response, next: NextFunction) {
    const auth = req.headers.auth || req.cookies.auth;
    if (!auth) {
      throw new HttpForbiddenException();
    }
    // A state-changing request that rides on the session cookie must come
    // from our own pages. This is a plain 403, not the session-clearing one:
    // the person's own session is fine, only this request is refused.
    if (
      !isAllowedBrowserRequest({
        method: req.method,
        usesCookie: !req.headers.auth && !!req.cookies.auth,
        origin: req.headers.origin,
        referer: req.headers.referer,
      })
    ) {
      throw new ForbiddenException('Cross-site request refused');
    }
    try {
      // Verify the JWT signature only. Never trust authorization-relevant
      // claims (id, isSuperAdmin, activated) from the token body — always
      // re-resolve the user from the database using the id.
      //
      // Only a sign-in session is accepted here: not an emailed link, not an
      // invite. See checkSessionPayload for the rules, including how sessions
      // from before tokens had an expiry are carried over.
      const payload = AuthService.verifyJWT(String(auth)) as {
        id?: string;
        iat?: number;
      } | null;
      const orgHeader = req.cookies.showorg || req.headers.showorg;

      const session = checkSessionPayload(payload);
      if (!session.ok) {
        throw new HttpForbiddenException();
      }

      let user = (await this._userService.getUserById(
        session.userId
      )) as User | null;

      if (!user) {
        throw new HttpForbiddenException();
      }

      if (!user.activated) {
        throw new HttpForbiddenException();
      }

      // Signed before the password last changed.
      if (isRevokedSession(payload?.iat, user.sessionsRevokedAt)) {
        throw new HttpForbiddenException();
      }

      // An old-style session, or one past its halfway mark: hand back a fresh
      // one with the same cookie the sign-in routes write, so nobody who keeps
      // using the app is ever signed out by the expiry.
      if (session.refresh) {
        setAuthCookie(res, signSessionToken(user.id));
      }

      const impersonate = req.cookies.impersonate || req.headers.impersonate;
      if (user?.isSuperAdmin && impersonate) {
        const loadImpersonate = await this._organizationService.getUserOrg(
          impersonate
        );

        if (loadImpersonate) {
          user = loadImpersonate.user;
          user.isSuperAdmin = true;
          delete user.password;

          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          req.user = user;

          // @ts-ignore
          loadImpersonate.organization.users =
            loadImpersonate.organization.users.filter(
              (f) => f.userId === user.id
            );
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          req.org = loadImpersonate.organization;
          next();
          return;
        }
      }

      delete user.password;
      const organization = (
        await this._organizationService.getOrgsByUserId(user.id)
      ).filter((f) => !f.users[0].disabled);
      const setOrg =
        organization.find((org) => org.id === orgHeader) || organization[0];

      if (!organization) {
        throw new HttpForbiddenException();
      }

      if (!setOrg.apiKey) {
        await this._organizationService.updateApiKey(setOrg.id);
      }

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      req.user = user;

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      req.org = setOrg;

      // Decided here, where every organization of the user is at hand, and
      // carried on the user so /user/self reports the very same answer.
      // @ts-ignore
      user.needsOnboarding = needsOnboarding(user, organization);
    } catch (err) {
      throw new HttpForbiddenException();
    }

    // An expired trial is the free plan, not a lockout, so nothing is blocked
    // here for its subscription. What does block the whole app is onboarding
    // that was never finished: the frontend shows the form instead of the app,
    // and this is what makes skipping it pointless.
    const path = req.originalUrl.split('?')[0];
    if (
      // @ts-ignore
      req.user?.needsOnboarding &&
      !onboardingOpenPaths.some((open) => path.endsWith(open))
    ) {
      throw new SubscriptionException({
        section: Sections.ONBOARDING,
        action: AuthorizationActions.Read,
      });
    }

    // A signed-in session that has not agreed to the current Terms can read
    // itself, agree, or leave. An admin impersonating somebody returned further
    // up and never gets here.
    if (
      // @ts-ignore
      needsTerms(req.user) &&
      !termsOpenPaths.some((open) => path.endsWith(open))
    ) {
      throw new SubscriptionException({
        section: Sections.TERMS,
        action: AuthorizationActions.Read,
      });
    }

    next();
  }
}
