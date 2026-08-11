import { Body, Controller, Headers, HttpException, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { User } from '@prisma/client';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import {
  ProvisionAccessDto,
  ProvisionCreateDto,
  ProvisionLookupDto,
  ProvisionSessionDto,
} from '@gitroom/nestjs-libraries/dtos/provision/provision.dto';

/**
 * Account provisioning for a trusted first-party front end.
 *
 * This exists because signup on the website happens after payment has already
 * been taken somewhere else, so the customer should land inside Studio rather
 * than in an inbox waiting for an activation link. Nothing here is reachable
 * without the shared secret, and none of it is part of the public API.
 *
 * Deliberately kept dumb about billing: the caller says when access should
 * lapse and this writes it down. Studio never asks who was paid or how much,
 * which keeps the payment provider entirely on the caller's side.
 *
 * The grant is always time limited. `subscriptionService.whitelistOrganization`
 * can grant forever by passing a null date, and that is exactly what must not
 * happen here: access has to follow the subscription, so a customer who stops
 * paying stops having access.
 */
@ApiTags('Provision')
@Controller('/public/provision')
export class ProvisionController {
  constructor(
    private _organizationService: OrganizationService,
    private _subscriptionService: SubscriptionService,
    private _userService: UsersService
  ) {}

  // The secret is the only thing standing in front of account creation, so a
  // missing or short one disables the endpoints rather than weakening them.
  private assertSecret(given?: string) {
    const expected = process.env.PROVISION_SECRET;
    if (!expected || expected.length < 32) {
      throw new HttpException('Provisioning is not configured', 404);
    }

    const a = Buffer.from(given || '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new HttpException('Unauthorized', 401);
    }
  }

  private sign(user: User) {
    const copy = { ...user } as Partial<User>;
    delete copy.password;
    return AuthChecker.signJWT(copy);
  }

  /**
   * Whether an account already exists for this email, and nothing else.
   *
   * The caller uses it to warn someone that re-onboarding will overwrite their
   * brief. It deliberately returns no profile, no name and no billing state:
   * this endpoint is a yes/no, not a lookup service.
   */
  @Post('/lookup')
  async lookup(
    @Headers('x-provision-secret') secret: string,
    @Body() body: ProvisionLookupDto
  ) {
    this.assertSecret(secret);

    const user = await this._userService.getUserByEmail(
      body.email.toLowerCase()
    );
    if (!user) {
      return { exists: false };
    }

    const orgs = await this._organizationService.getOrgsByUserId(user.id);
    return { exists: true, orgId: orgs?.[0]?.id ?? null };
  }

  /**
   * Creates the organization pre-activated and grants access to `activeUntil`.
   *
   * Uses `createActivatedOrgAndUser` so the account is usable straight away.
   * That is the whole reason this endpoint exists rather than reusing
   * /auth/register, which sends an activation mail whenever an email provider
   * is configured and returns no session until the link is clicked.
   */
  @Post('/create')
  async create(
    @Headers('x-provision-secret') secret: string,
    @Body() body: ProvisionCreateDto
  ) {
    this.assertSecret(secret);

    const email = body.email.toLowerCase();
    const until = new Date(body.activeUntil);
    if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
      throw new HttpException('activeUntil must be a future date', 400);
    }

    if (await this._userService.getUserByEmail(email)) {
      throw new HttpException('Email already exists', 409);
    }

    // Activated on creation: payment has already been taken, and sending
    // someone to their inbox at this point loses them.
    const created = await this._organizationService.createActivatedOrgAndUser(
      {
        email,
        password: body.password,
        provider: 'LOCAL',
        company: body.company,
      } as never,
      '',
      'apex-provisioning'
    );

    const orgId = created.id;
    await this._subscriptionService.whitelistOrganizationUntil(
      orgId,
      until,
      'apex-stripe'
    );

    const organization = await this._organizationService.getOrgById(orgId);

    return {
      orgId,
      // The stored value is what the Authorization header must carry: the
      // public API compares it as-is.
      apiKey: organization?.apiKey ?? null,
      jwt: this.sign(created.users[0].user),
    };
  }

  /**
   * Moves the expiry, or expires it now. Driven by whatever the caller's
   * payment provider says has happened.
   */
  @Post('/access')
  async access(
    @Headers('x-provision-secret') secret: string,
    @Body() body: ProvisionAccessDto
  ) {
    this.assertSecret(secret);

    const organization = await this._organizationService.getOrgById(body.orgId);
    if (!organization) {
      throw new HttpException('Organization not found', 404);
    }

    if (body.revoke) {
      // Expires rather than deletes. A deleted subscription row reads as "no
      // subscription", which means unlimited on installs without billing.
      await this._subscriptionService.removeWhitelistFromOrganization(
        body.orgId
      );
      return { orgId: body.orgId, access: false };
    }

    if (!body.activeUntil) {
      throw new HttpException('activeUntil or revoke is required', 400);
    }

    const until = new Date(body.activeUntil);
    if (Number.isNaN(until.getTime())) {
      throw new HttpException('activeUntil must be a valid date', 400);
    }

    await this._subscriptionService.whitelistOrganizationUntil(
      body.orgId,
      until,
      'apex-stripe'
    );

    return { orgId: body.orgId, access: true, activeUntil: until.toISOString() };
  }

  /**
   * A fresh session and the organization's API key, for a caller that already
   * proved itself with the shared secret.
   *
   * Returning the API key here means the caller never has to store one: it can
   * ask again whenever it needs to write to this account. Both values are
   * credentials for the whole organization, so this is server-to-server only
   * and neither may be forwarded to a browser.
   */
  @Post('/session')
  async session(
    @Headers('x-provision-secret') secret: string,
    @Body() body: ProvisionSessionDto
  ) {
    this.assertSecret(secret);

    const organization = await this._organizationService.getOrgById(body.orgId);
    if (!organization) {
      throw new HttpException('Organization not found', 404);
    }

    const team = await this._organizationService.getTeam(body.orgId);
    const owner =
      team?.users?.find((member) => member.role === 'SUPERADMIN') ??
      team?.users?.[0];

    if (!owner) {
      throw new HttpException('Organization has no users', 404);
    }

    // getTeam returns a trimmed user, and the session has to be signed over the
    // whole row.
    const user = await this._userService.getUserByEmail(owner.user.email);
    if (!user) {
      throw new HttpException('Organization owner not found', 404);
    }

    return {
      orgId: body.orgId,
      apiKey: organization.apiKey ?? null,
      jwt: this.sign(user),
    };
  }
}
