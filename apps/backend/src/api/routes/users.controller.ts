import {
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { sign } from 'jsonwebtoken';
import { Organization, User } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { PaymentService } from '@gitroom/nestjs-libraries/services/payment/payment.service';
import { Response, Request } from 'express';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { clearAuthCookie } from '@gitroom/backend/services/auth/auth.cookie';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { ApiTags } from '@nestjs/swagger';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { needsTerms } from '@gitroom/nestjs-libraries/database/prisma/users/terms';
import { UserDetailDto } from '@gitroom/nestjs-libraries/dtos/users/user.details.dto';
import { OnboardingDto } from '@gitroom/nestjs-libraries/dtos/users/onboarding.dto';
import { TutorialProgressDto } from '@gitroom/nestjs-libraries/dtos/users/tutorial-progress.dto';
import { isGrowthViewer } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/growth.viewer';
import { EmailNotificationsDto } from '@gitroom/nestjs-libraries/dtos/users/email-notifications.dto';
import { TimezoneDto } from '@gitroom/nestjs-libraries/dtos/users/timezone.dto';
import { HttpForbiddenException } from '@gitroom/nestjs-libraries/services/exception.filter';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { applyTrackCookies } from '@gitroom/nestjs-libraries/track/track.cookies';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import {
  AccessOrganization,
  hasAccess,
  isActiveSubscription,
  trialEndsAt,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';
import { WalletService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import { AgentConnectionService } from '@gitroom/nestjs-libraries/database/prisma/agent-connections/agent-connection.service';

// The organization from the request carries the user's own membership.
const isOrgAdmin = (organization?: Organization) =>
  // @ts-ignore
  ['SUPERADMIN', 'ADMIN'].includes(organization?.users?.[0]?.role);

@ApiTags('User')
@Controller('/user')
export class UsersController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _paymentService: PaymentService,
    private _authService: AuthService,
    private _orgService: OrganizationService,
    private _userService: UsersService,
    private _trackService: TrackService,
    private _walletService: WalletService,
    private _agentConnectionService: AgentConnectionService
  ) {}

  // Whether an AI agent has reached the MCP for this workspace yet, for the
  // connect-agent panel's live status.
  @Get('/agent-connection')
  getAgentConnection(@GetOrgFromRequest() organization: Organization) {
    return this._agentConnectionService.status(organization.id);
  }

  @Get('/chatbase-token')
  async getChatbaseToken(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization
  ) {
    if (!process.env.CHATBASE_TOKEN) {
      throw new HttpException('Chatbase SSO is not configured', 400);
    }

    const token = sign(
      {
        user_id: organization.id,
        email: user.email,
        ...(organization.paymentId
          ? {
              stripe_accounts: [
                {
                  label: organization.name,
                  stripe_id: organization.paymentId,
                },
              ],
            }
          : {}),
      },
      process.env.CHATBASE_TOKEN,
      { expiresIn: '1h' }
    );

    return { token };
  }

  @Get('/self')
  async getSelf(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Req() req: Request
  ) {
    if (!organization) {
      throw new HttpForbiddenException();
    }

    const impersonate = req.cookies.impersonate || req.headers.impersonate;
    // The middleware loads the organization with its subscription, which the
    // bare Prisma type does not carry.
    const org = organization as Organization & {
      subscription?: {
        subscriptionTier?: string;
        cancelAt?: Date | null;
        deletedAt?: Date | null;
        // Tells a paying customer's expiry apart from a trial countdown.
        identifier?: string | null;
      } | null;
    };
    // Where they signed up and agreed from is ours to keep, not to echo back
    // to the browser; the rest of the user row is what the app reads.
    const {
      ip: _ip,
      agent: _agent,
      termsAcceptedIp: _termsAcceptedIp,
      contactConsentIp: _contactConsentIp,
      inviteId: _inviteId,
      sessionsRevokedAt: _sessionsRevokedAt,
      ...publicUser
    } = user;
    // @ts-ignore
    return {
      ...publicUser,
      orgId: organization.id,
      totalChannels: !process.env.STRIPE_PUBLISHABLE_KEY
        ? 10000
        : // @ts-ignore
          organization?.subscription?.totalChannels || pricing.FREE.channel,
      tier:
        // An expired trial grants nothing, so it reports FREE - that is what
        // paints the app as locked if the user ever gets past the redirect.
        (isActiveSubscription(org?.subscription) &&
          org?.subscription?.subscriptionTier) ||
        (hasAccess(org) && !process.env.STRIPE_PUBLISHABLE_KEY
          ? 'ULTIMATE'
          : 'FREE'),
      // When the free trial ends. `null` when the organization is whitelisted
      // forever, and also when it is paying: that expiry moves forward on every
      // renewal, so counting it down would tell a customer who is not going
      // anywhere that their access is about to run out.
      trialEndsAt: trialEndsAt(org),
      // Plus, pay-as-you-go from before Plus, or a top-up with credit left
      // opens X, the brief, skills and research data without changing the
      // plan above.
      // A paid plan never uses the wallet, so its wallet is not read.
      ...(hasAccess(org)
        ? { payAsYouGo: false, plus: false }
        : await this._walletService
            .access(organization.id)
            .then((a) => ({ payAsYouGo: a.open, plus: a.plus }))),
      // The app is held on the onboarding steps until this is false.
      // @ts-ignore
      needsOnboarding: !!user.needsOnboarding,
      // Onboarded before the welcome credits existed: the onboarding opens
      // once more until they are claimed or turned down. Free-plan admins
      // only; never while impersonating.
      welcomeCreditsPending:
        !impersonate &&
        !user.isSuperAdmin &&
        !!user.onboardedAt &&
        isOrgAdmin(organization) &&
        // The agent step needs the key, as the frontend's admin check does.
        !!organization.apiKey &&
        !hasAccess(org) &&
        (await this._userService.welcomeCreditsPending(organization.id)),
      // The app is replaced by a one-screen agreement until this is false.
      needsTerms: !impersonate && needsTerms(user),
      // @ts-ignore
      role: organization?.users[0]?.role,
      // @ts-ignore
      isLifetime: !!organization?.subscription?.isLifetime,
      admin: !!user.isSuperAdmin,
      // Shows the growth dashboard link. The dashboard checks again itself.
      growthViewer: !impersonate && isGrowthViewer(user.email),
      impersonate: !!impersonate,
      isTrailing: !process.env.STRIPE_PUBLISHABLE_KEY
        ? false
        : organization?.isTrailing,
      allowTrial: organization?.allowTrial,
      streakSince: organization?.streakSince || null,
      // Onboarding itself connects the agent with this key.
      publicApi: isOrgAdmin(organization) ? organization?.apiKey : '',
    };
  }

  @Get('/personal')
  async getPersonalInformation(@GetUserFromRequest() user: User) {
    return this._userService.getPersonal(user.id);
  }

  @Get('/impersonate')
  async getImpersonate(
    @GetUserFromRequest() user: User,
    @Query('name') name: string
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    return this._userService.getImpersonateUser(name);
  }

  @Post('/impersonate')
  async setImpersonate(
    @GetUserFromRequest() user: User,
    @Body('id') id: string,
    @Res({ passthrough: true }) response: Response
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    response.cookie('impersonate', id, {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    });

    if (process.env.NOT_SECURED) {
      response.header('impersonate', id);
    }
  }

  @Post('/switch')
  async switchUser(
    @GetUserFromRequest() user: User,
    @Body('id') id: string,
    @Req() req: Request
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    // `user` is the impersonated account, so the admin id comes from the token.
    // Require an active impersonation session and never allow the admin's own
    // account in the swap — either would trade away the admin's login.
    const adminId = this.getRequestUserId(req);
    if (
      !id ||
      !adminId ||
      id === user.id ||
      adminId === user.id ||
      adminId === id
    ) {
      throw new HttpException('Invalid user to switch to', 400);
    }

    const { kept, switched } = await this._userService.switchUser(
      user.id,
      id,
      adminId
    );

    await this._paymentService.syncCustomerEmailsAfterSwitch([kept, switched]);

    return { success: true };
  }

  private getRequestUserId(req: Request): string | null {
    try {
      const auth = (req.headers.auth as string) || req.cookies?.auth;
      const payload = AuthChecker.verifyJWT(auth) as { id?: string } | null;
      return payload?.id || null;
    } catch {
      return null;
    }
  }

  @Post('/personal')
  async changePersonal(
    @GetUserFromRequest() user: User,
    @Body() body: UserDetailDto
  ) {
    return this._userService.changePersonal(user.id, body);
  }

  // Where onboarding stands: what the onboarding steps poll.
  @Get('/onboarding')
  onboardingStatus(@GetOrgFromRequest() organization: Organization) {
    return this._userService.onboardingStatus(
      organization.id,
      isOrgAdmin(organization),
      !hasAccess(organization as AccessOrganization)
    );
  }

  @Post('/onboarding')
  async completeOnboarding(
    @GetUserFromRequest() user: User,
    @Body() body: OnboardingDto
  ) {
    await this._userService.completeOnboarding(user.id, body);
    return { success: true };
  }

  // The welcome credits, once the agent is connected and has filled at least
  // one item of the brief.
  // Never while impersonating: the decision is the person's own.
  @Post('/onboarding/credits')
  async claimWelcomeCredits(
    @GetOrgFromRequest() organization: Organization,
    @Req() req: Request
  ) {
    if (req.cookies.impersonate || req.headers.impersonate) {
      return { credits: 0 };
    }
    return this._userService.claimWelcomeCredits(
      organization.id,
      isOrgAdmin(organization),
      !hasAccess(organization as AccessOrganization)
    );
  }

  // Turning the welcome credits down. Final, so never while impersonating.
  @Post('/onboarding/credits/skip')
  async skipWelcomeCredits(
    @GetOrgFromRequest() organization: Organization,
    @Req() req: Request
  ) {
    if (req.cookies.impersonate || req.headers.impersonate) {
      return { success: true };
    }
    await this._userService.skipWelcomeCredits(
      organization.id,
      isOrgAdmin(organization)
    );
    return { success: true };
  }

  // How far the person got in the onboarding tutorial video. Ignored while
  // impersonating, so support watching it does not count as the user.
  @Post('/tutorial')
  async tutorialProgress(
    @GetUserFromRequest() user: User,
    @Req() req: Request,
    @Body() body: TutorialProgressDto
  ) {
    if (req.cookies.impersonate || req.headers.impersonate) {
      return { success: true };
    }
    await this._userService.recordTutorialProgress(user.id, body);
    return { success: true };
  }

  // Agreeing to the current Terms. Signing up does this already; this is for
  // everybody who had an account before we kept a record, and for every time
  // the Terms change. Never while impersonating: only the person themselves
  // can agree.
  @Post('/terms')
  async acceptTerms(
    @GetUserFromRequest() user: User,
    @Req() req: Request,
    @RealIP() ip: string,
    @UserAgent() userAgent: string
  ) {
    if (req.cookies.impersonate || req.headers.impersonate) {
      throw new HttpForbiddenException();
    }

    await this._userService.acceptTerms(user.id, ip, userAgent);
    return { success: true };
  }

  @Get('/email-notifications')
  async getEmailNotifications(@GetUserFromRequest() user: User) {
    return this._userService.getEmailNotifications(user.id);
  }

  @Post('/email-notifications')
  async updateEmailNotifications(
    @GetUserFromRequest() user: User,
    @Body() body: EmailNotificationsDto
  ) {
    return this._userService.updateEmailNotifications(user.id, body);
  }

  @Post('/timezone')
  async updateTimezone(
    @GetUserFromRequest() user: User,
    @Body() body: TimezoneDto
  ) {
    return this._userService.updateTimezone(user.id, body);
  }

  @Post('/api-key/rotate')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async rotateApiKey(@GetOrgFromRequest() organization: Organization) {
    return this._orgService.updateApiKey(organization.id);
  }

  @Get('/subscription')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async getSubscription(@GetOrgFromRequest() organization: Organization) {
    const subscription = await this._paymentService.getSubscription(
      organization.id
    );

    return subscription ? { subscription } : { subscription: undefined };
  }

  @Get('/subscription/tiers')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async tiers() {
    return this._paymentService.getDefaultProvider('web').getPackages();
  }

  @Post('/join-org')
  async joinOrg(
    @GetUserFromRequest() user: User,
    @Body('org') org: string,
    @Res({ passthrough: true }) response: Response
  ) {
    const getOrgFromCookie = this._authService.getOrgFromCookie(org);

    if (!getOrgFromCookie) {
      return response.status(200).json({ id: null });
    }

    const addedOrg = await this._orgService.addUserToOrg(
      user.id,
      getOrgFromCookie.id,
      getOrgFromCookie.orgId,
      getOrgFromCookie.role
    );

    response.status(200).json({
      id: typeof addedOrg !== 'boolean' ? addedOrg.organizationId : null,
    });
  }

  @Get('/organizations')
  async getOrgs(@GetUserFromRequest() user: User) {
    return (await this._orgService.getOrgsByUserId(user.id))
      .filter((f) => !f.users[0].disabled)
      .map((p) => ({
        id: p.id,
        name: p.name,
        users: p.users,
        subscription: p.subscription,
      }));
  }

  @Post('/change-org')
  changeOrg(
    @Body('id') id: string,
    @Res({ passthrough: true }) response: Response
  ) {
    response.cookie('showorg', id, {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    });

    if (process.env.NOT_SECURED) {
      response.header('showorg', id);
    }

    response.status(200).send();
  }

  @Get('/delete-account-info')
  getDeleteAccountInfo(@GetUserFromRequest() user: User) {
    return this._userService.getDeleteAccountInfo(user.id);
  }

  @Post('/delete-account')
  async deleteAccount(
    @GetUserFromRequest() user: User,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const impersonate = req.cookies.impersonate || req.headers.impersonate;
    if (impersonate) {
      throw new HttpException(
        'Account cannot be deleted while impersonating',
        400
      );
    }

    // Cancel billing before scrubbing the account — once the account is
    // deleted there is no way to retry a failed cancellation
    const ownedOrgs = await this._userService.getOrgsToDeleteForAccount(
      user.id
    );

    for (const org of ownedOrgs) {
      try {
        await this._paymentService.cancelAllSubscriptions(org.id);
      } catch (err) {
        console.log(err);
        throw new HttpException(
          'Could not cancel your subscription, please try again or contact support',
          400
        );
      }
    }

    await this._userService.deleteAccount(user.id);

    return this.logout(response);
  }

  @Post('/delete-organization')
  async deleteOrganization(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request
  ) {
    const impersonate = req.cookies.impersonate || req.headers.impersonate;
    if (impersonate) {
      throw new HttpException(
        'Organization cannot be deleted while impersonating',
        400
      );
    }

    await this._userService.getOrgToDelete(user.id, org.id);

    // Wallet credit is paid money and is lost with the organization
    if ((await this._walletService.balance(org.id)) > 0) {
      throw new HttpException(
        'This organization still has wallet credit, please use it or contact support before deleting it',
        400
      );
    }

    // Cancel billing before deleting — once the organization is deleted
    // there is no way to retry a failed cancellation
    try {
      await this._paymentService.cancelAllSubscriptions(org.id);
    } catch (err) {
      console.log(err);
      throw new HttpException(
        'Could not cancel your subscription, please try again or contact support',
        400
      );
    }

    await this._userService.deleteOrganization(user.id, org.id);
  }

  @Post('/logout')
  logout(@Res({ passthrough: true }) response: Response) {
    response.header('logout', 'true');
    clearAuthCookie(response);

    response.cookie('showorg', '', {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      maxAge: -1,
      expires: new Date(0),
    });

    response.cookie('impersonate', '', {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      maxAge: -1,
      expires: new Date(0),
    });

    response.status(200).send();
  }

  @Post('/t')
  async trackEvent(
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @GetUserFromRequest() user: User,
    @RealIP() ip: string,
    @UserAgent() userAgent: string,
    @Body()
    body: { tt: TrackEnum; fbclid: string; additional: Record<string, any> }
  ) {
    const { uniqueId, fbc, fbp } = applyTrackCookies(req, res, body.fbclid);
    this._trackService
      .track(
        uniqueId,
        ip,
        userAgent,
        body.tt,
        body.additional,
        fbc,
        user,
        fbp
      )
      .catch((err) => {});

    res.status(200).json({
      track: uniqueId,
    });
  }
}
