import { Injectable } from '@nestjs/common';
import { Provider, User } from '@prisma/client';
import {
  termsRequiredMessage,
  contactConsentRequiredMessage,
} from '@gitroom/nestjs-libraries/database/prisma/users/terms';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { LoginUserDto } from '@gitroom/nestjs-libraries/dtos/auth/login.user.dto';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { AuthProviderManager } from '@gitroom/backend/services/auth/providers/providers.manager';
import dayjs from 'dayjs';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { ForgotReturnPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot-return.password.dto';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { NewsletterService } from '@gitroom/nestjs-libraries/newsletter/newsletter.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  isInLegacyWindow,
  RESET_TTL_SECONDS,
  signActivationToken,
  signResetToken,
  signSessionToken,
  verifyTypedToken,
} from '@gitroom/helpers/auth/session.token';
import { createHash, randomBytes } from 'crypto';

// A provider token is accepted for sign-in only if it came out of our own
// code exchange (checkExists) a short while ago. Long enough to fill in the
// sign-up form that follows it.
const PROVIDER_TOKEN_TTL_SECONDS = 15 * 60;
// How long a social login link stays usable.
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const providerTokenKey = (provider: string, token: string) =>
  `provider-token:${provider}:${sha256(token)}`;
const oauthStateKey = (state: string) => `oauth-state:${state}`;
const usedResetKey = (jti: string) => `reset-used:${jti}`;

@Injectable()
export class AuthService {
  constructor(
    private _userService: UsersService,
    private _organizationService: OrganizationService,
    private _notificationService: NotificationService,
    private _emailService: EmailService,
    private _providerManager: AuthProviderManager
  ) {}
  async canRegister(provider: string) {
    if (
      process.env.DISABLE_REGISTRATION !== 'true' ||
      provider === Provider.GENERIC
    ) {
      return true;
    }

    return (await this._organizationService.getCount()) === 0;
  }

  async routeAuth(
    provider: Provider,
    body: CreateOrgUserDto | LoginUserDto,
    ip: string,
    userAgent: string,
    addToOrg?: boolean | { orgId: string; role: 'USER' | 'ADMIN'; id: string }
  ) {
    if (provider === Provider.LOCAL) {
      if (process.env.DISALLOW_PLUS && body.email.includes('+')) {
        throw new Error('Email with plus sign is not allowed');
      }
      if (body instanceof CreateOrgUserDto) {
        body.email = body.email.toLowerCase();
      }
      const user = await this._userService.getUserByEmail(body.email);
      if (body instanceof CreateOrgUserDto) {
        if (user) {
          throw new Error('Email already exists');
        }

        if (!(await this.canRegister(provider))) {
          throw new Error('Registration is disabled');
        }


        if (!body.termsAccepted) {
          throw new Error(termsRequiredMessage());
        }

        if (!body.contactConsent) {
          throw new Error(contactConsentRequiredMessage());
        }

        const create = await this._organizationService.createOrgAndUser(
          body,
          ip,
          userAgent
        );

        const addedOrg =
          addToOrg && typeof addToOrg !== 'boolean'
            ? await this._organizationService.addUserToOrg(
                create.users[0].user.id,
                addToOrg.id,
                addToOrg.orgId,
                addToOrg.role
              )
            : false;

        const obj = { addedOrg, jwt: await this.jwt(create.users[0].user) };
        await this._emailService.sendEmail(
          body.email,
          'Activate your account',
          `Click <a href="${process.env.FRONTEND_URL}/auth/activate/${signActivationToken(
            create.users[0].user.id
          )}">here</a> to activate your account`,
          'top'
        );
        return obj;
      }

      if (!user || !AuthChecker.comparePassword(body.password, user.password)) {
        throw new Error('Invalid user name or password');
      }

      if (!user.activated) {
        throw new Error('User is not activated');
      }

      return { addedOrg: false, jwt: await this.jwt(user) };
    }

    const user = await this.loginOrRegisterProvider(
      provider,
      body as CreateOrgUserDto,
      ip,
      userAgent,
      !!addToOrg
    );

    const addedOrg =
      addToOrg && typeof addToOrg !== 'boolean'
        ? await this._organizationService.addUserToOrg(
            user.id,
            addToOrg.id,
            addToOrg.orgId,
            addToOrg.role
          )
        : false;
    return { addedOrg, jwt: await this.jwt(user) };
  }

  public getOrgFromCookie(cookie?: string) {
    if (!cookie) {
      return false;
    }

    try {
      const getOrg: any = AuthChecker.verifyJWT(cookie);
      // An invite, typed or from before invites had a type. Never any other
      // kind of token, and never one without the organization it is for.
      if (
        !getOrg ||
        typeof getOrg !== 'object' ||
        (getOrg.type !== undefined && getOrg.type !== 'invite') ||
        !getOrg.orgId ||
        !getOrg.timeLimit
      ) {
        return false;
      }
      if (dayjs(getOrg.timeLimit).isBefore(dayjs())) {
        return false;
      }

      return getOrg as {
        email: string;
        role: 'USER' | 'ADMIN';
        orgId: string;
        id: string;
      };
    } catch (err) {
      return false;
    }
  }

  private async loginOrRegisterProvider(
    provider: Provider,
    body: CreateOrgUserDto,
    ip: string,
    userAgent: string,
    invited: boolean
  ) {
    const providerInstance = this._providerManager.getProvider(provider);

    // Only a token our own code exchange produced (checkExists) is accepted,
    // so a token obtained elsewhere cannot be used to sign in as its owner.
    if (
      !body.providerToken ||
      !(await ioRedis.get(providerTokenKey(provider, body.providerToken)))
    ) {
      throw new Error('Invalid provider token');
    }

    const providerUser = await providerInstance.getUser(body.providerToken);

    if (!providerUser || !providerUser.id) {
      throw new Error('Invalid provider token');
    }

    const user = await this._userService.getUserByProvider(
      providerUser.id,
      provider
    );
    if (user) {
      await ioRedis.del(providerTokenKey(provider, body.providerToken));
      return user;
    }

    if (!(await this.canRegister(provider))) {
      throw new Error('Registration is disabled');
    }


    // Only a new account has to agree. Somebody who already has one came
    // through this same function to sign in and returned above.
    if (!body.termsAccepted) {
      throw new Error(termsRequiredMessage());
    }

    if (!body.contactConsent) {
      throw new Error(contactConsentRequiredMessage());
    }

    const create = await this._organizationService.createOrgAndUser(
      {
        company: body.company,
        email: providerUser.email,
        password: '',
        provider,
        providerId: providerUser.id,
        datafast_visitor_id: body.datafast_visitor_id,
        termsAccepted: body.termsAccepted,
        contactConsent: body.contactConsent,
      },
      ip,
      userAgent
    );

    this._track('register', providerUser.email, body.datafast_visitor_id).catch(
      (err) => {}
    );

    await NewsletterService.register(providerUser.email);

    try {
      if (providerInstance?.postRegistration) {
        await providerInstance.postRegistration(body.providerToken, create.id);
      }
    } catch (err) {
      // Don't fail registration if postRegistration fails
    }

    await ioRedis.del(providerTokenKey(provider, body.providerToken));

    return create.users[0].user;
  }

  private async _track(
    name: string,
    email: string,
    datafast_visitor_id: string
  ) {
    if (email && datafast_visitor_id && process.env.DATAFAST_API_KEY) {
      try {
        await fetch('https://datafa.st/api/v1/goals', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.DATAFAST_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            datafast_visitor_id: datafast_visitor_id,
            name: name,
            metadata: {
              email,
            },
          }),
        });
      } catch (err) {}
    }
  }

  async forgot(email: string) {
    const user = await this._userService.getUserByEmail(email);
    if (!user || user.providerName !== Provider.LOCAL) {
      return false;
    }

    const resetValues = signResetToken(user.id);

    await this._notificationService.sendEmail(
      user.email,
      'Reset your password',
      `You have requested to reset your passsord. <br />Click <a href="${process.env.FRONTEND_URL}/auth/forgot/${resetValues}">here</a> to reset your password<br />The link will expire in 20 minutes`
    );
  }

  async forgotReturn(body: ForgotReturnPasswordDto) {
    const reset = verifyTypedToken(body.token, 'reset');
    if (!reset || !reset.id || typeof reset.jti !== 'string') {
      return false;
    }

    // A reset link works once. Claimed before the password changes, so two
    // requests racing with the same link cannot both get through.
    const ttl = Math.max(
      1,
      Math.min(
        RESET_TTL_SECONDS,
        Math.ceil((reset.exp as number) - Date.now() / 1000)
      )
    );
    const claimed = await ioRedis.set(
      usedResetKey(reset.jti),
      '1',
      'EX',
      ttl,
      'NX'
    );
    if (claimed !== 'OK') {
      return false;
    }

    // Also signs out every session opened before now (sessionsRevokedAt).
    return this._userService.updatePassword(reset.id, body.password);
  }

  async activate(code: string, tracking: string) {
    let userId: string | undefined;
    const typed = verifyTypedToken(code, 'activate');
    if (typed?.id) {
      userId = typed.id;
    } else {
      // Links emailed before activation links had their own type were the
      // user row itself. They keep working for people who signed up just
      // before this release, until the old-style cutoff.
      try {
        const legacy = AuthChecker.verifyJWT(code) as any;
        if (
          legacy &&
          typeof legacy === 'object' &&
          legacy.id &&
          legacy.activated === false &&
          isInLegacyWindow(legacy)
        ) {
          userId = legacy.id;
        }
      } catch {
        userId = undefined;
      }
    }

    if (!userId) {
      return false;
    }

    const user = await this._userService.getUserById(userId);
    if (!user || user.activated) {
      return false;
    }

    await this._userService.activateUser(user.id);
    this._track('register', user.email, tracking).catch((err) => {});
    await NewsletterService.register(user.email);
    return this.jwt(user);
  }

  // Says nothing about whether the address has an account or is already
  // activated: the caller always gets the same answer.
  async resendActivationEmail(email: string) {
    const user = await this._userService.getUserByEmail(email);

    if (!user || user.activated) {
      return true;
    }

    await this._emailService.sendEmail(
      user.email,
      'Activate your account',
      `Click <a href="${process.env.FRONTEND_URL}/auth/activate/${signActivationToken(
        user.id
      )}">here</a> to activate your account`,
      'top'
    );

    return true;
  }

  async oauthLink(provider: string, query?: any) {
    const providerInstance = this._providerManager.getProvider(provider);
    if (!providerInstance.requiresState) {
      return providerInstance.generateLink(query);
    }

    // `login_` first: see GoogleProvider.generateLink.
    const state = `login_${randomBytes(16).toString('hex')}`;
    await ioRedis.set(
      oauthStateKey(state),
      provider,
      'EX',
      OAUTH_STATE_TTL_SECONDS
    );
    return providerInstance.generateLink(query, state);
  }

  // One use only, and only for the provider it was issued for.
  private async consumeOauthState(provider: string, state?: string) {
    if (!state || typeof state !== 'string' || state.length > 200) {
      return false;
    }
    const key = oauthStateKey(state);
    const stored = await ioRedis.get(key);
    if (stored !== provider) {
      return false;
    }
    return (await ioRedis.del(key)) > 0;
  }


  async checkExists(
    provider: string,
    code: string,
    redirectUri?: string,
    invited = false,
    state?: string
  ) {
    const providerInstance = this._providerManager.getProvider(provider);
    if (
      providerInstance.requiresState &&
      !(await this.consumeOauthState(provider, state))
    ) {
      throw new Error('This sign-in link has expired. Please try again.');
    }

    const token = await providerInstance.getToken(code, redirectUri);
    if (!token) {
      throw new Error('Invalid user');
    }
    const user = await providerInstance.getUser(token);
    if (!user) {
      throw new Error('Invalid user');
    }
    const checkExists = await this._userService.getUserByProvider(
      user.id,
      provider as Provider
    );
    if (checkExists) {
      return { jwt: await this.jwt(checkExists) };
    }

    await ioRedis.set(
      providerTokenKey(provider, token),
      '1',
      'EX',
      PROVIDER_TOKEN_TTL_SECONDS
    );

    return { token };
  }

  // The session carries the user id and nothing else: everything about the
  // user is read from the database on every request (AuthMiddleware).
  private async jwt(user: Pick<User, 'id'>) {
    return signSessionToken(user.id);
  }
}
