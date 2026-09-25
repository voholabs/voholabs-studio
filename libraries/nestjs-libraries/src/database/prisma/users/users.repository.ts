import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import {
  termsAcceptance,
  termsAcceptanceLog,
} from '@gitroom/nestjs-libraries/database/prisma/users/terms';
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Provider, Role } from '@prisma/client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { UserDetailDto } from '@gitroom/nestjs-libraries/dtos/users/user.details.dto';
import { OnboardingDto } from '@gitroom/nestjs-libraries/dtos/users/onboarding.dto';
import { EmailNotificationsDto } from '@gitroom/nestjs-libraries/dtos/users/email-notifications.dto';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

@Injectable()
export class UsersRepository {
  constructor(
    private _user: PrismaRepository<'user'>,
    private _transaction: PrismaTransaction
  ) {}

  async switchUserCredentials(currentUserId: string, targetUserId: string) {
    const current = await this._user.model.user.findUnique({
      where: { id: currentUserId },
    });
    const target = await this._user.model.user.findUnique({
      where: { id: targetUserId },
    });

    if (!current || !target) {
      throw new Error('User not found');
    }

    const currentCredentials = {
      email: current.email,
      password: current.password,
      providerName: current.providerName,
      providerId: current.providerId,
      account: current.account,
      connectedAccount: current.connectedAccount,
      activated: current.activated,
    };
    const targetCredentials = {
      email: target.email,
      password: target.password,
      providerName: target.providerName,
      providerId: target.providerId,
      account: target.account,
      connectedAccount: target.connectedAccount,
      activated: target.activated,
    };

    // (email, providerName) is unique and checked per-statement, so park the
    // current user on a throwaway email first, then fill each freed slot
    await this._transaction.model.$transaction([
      this._user.model.user.update({
        where: { id: current.id },
        data: { email: `switch-${makeId(10)}-${current.email}` },
      }),
      this._user.model.user.update({
        where: { id: target.id },
        data: currentCredentials,
      }),
      this._user.model.user.update({
        where: { id: current.id },
        data: targetCredentials,
      }),
    ]);

    return {
      kept: { id: current.id, email: targetCredentials.email },
      switched: { id: target.id, email: currentCredentials.email },
    };
  }

  getImpersonateUser(name: string) {
    return this._user.model.user.findMany({
      where: {
        deletedAt: null,
        OR: [
          {
            name: {
              contains: name,
            },
          },
          {
            email: {
              contains: name,
            },
          },
          {
            id: {
              contains: name,
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
      take: 10,
    });
  }

  getUserById(id: string) {
    return this._user.model.user.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });
  }

  /**
   * The same question as getUserByEmail, without the LOCAL filter.
   *
   * That filter belongs to password login, where finding a Google account by
   * email would be a way in past its provider. It does not belong to "does this
   * address already have an account here", which is a different question and
   * the one provisioning asks. Kept as a separate method so the login path is
   * not widened by accident.
   */
  getUserByEmailAnyProvider(email: string) {
    return this._user.model.user.findFirst({
      where: { email },
    });
  }

  getUserByEmail(email: string) {
    return this._user.model.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
        providerName: Provider.LOCAL,
        deletedAt: null,
      },
      include: {
        picture: {
          select: {
            id: true,
            path: true,
          },
        },
      },
    });
  }

  getUserWithActiveSubscriptionByEmail(email: string, excludeUserId: string) {
    return this._user.model.user.findFirst({
      where: {
        email,
        id: { not: excludeUserId },
        deletedAt: null,
        organizations: {
          some: {
            role: Role.SUPERADMIN,
            organization: {
              subscription: { is: { deletedAt: null } },
            },
          },
        },
      },
      select: { id: true, email: true, providerName: true },
    });
  }

  activateUser(id: string) {
    return this._user.model.user.update({
      where: {
        id,
      },
      data: {
        activated: true,
      },
    });
  }

  getUserByProvider(providerId: string, provider: Provider) {
    return this._user.model.user.findFirst({
      where: {
        providerId,
        providerName: provider,
        deletedAt: null,
      },
    });
  }

  async deleteAccount(userId: string) {
    const user = await this._user.model.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user || user.deletedAt) {
      return;
    }

    const hash = (value: string) =>
      createHash('md5').update(value).digest('hex');

    // Hash the identifying fields instead of removing the row, the random
    // suffix keeps [email, providerName] unique if the same email is deleted
    // more than once
    return this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        email: `deleted_${hash(user.email.toLowerCase())}_${makeId(5)}`,
        password: null,
        name: user.name ? hash(user.name) : null,
        lastName: user.lastName ? hash(user.lastName) : null,
        providerId: user.providerId ? hash(user.providerId) : null,
        bio: null,
        ip: null,
        agent: null,
        account: null,
        pictureId: null,
        deletedAt: new Date(),
      },
    });
  }

  updatePassword(id: string, password: string) {
    return this._user.model.user.update({
      where: {
        id,
        providerName: Provider.LOCAL,
      },
      data: {
        password: AuthService.hashPassword(password),
      },
    });
  }

  changeAudienceSize(userId: string, audience: number) {
    return this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        audience,
      },
    });
  }

  async getPersonal(userId: string) {
    const user = await this._user.model.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        name: true,
        bio: true,
        picture: {
          select: {
            id: true,
            path: true,
          },
        },
      },
    });

    return user;
  }

  async changePersonal(userId: string, body: UserDetailDto) {
    await this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        name: body.fullname,
        bio: body.bio,
        picture: body.picture
          ? {
              connect: {
                id: body.picture.id,
              },
            }
          : {
              disconnect: true,
            },
      },
    });
  }

  completeOnboarding(userId: string, body: OnboardingDto) {
    return this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        name: body.name,
        website: body.website.trim().toLowerCase(),
        jobRole: body.role,
        heardFrom: body.heardFrom,
        useCase: body.useCase,
        attribution: body.attribution || null,
        onboardedAt: new Date(),
      },
      select: {
        id: true,
      },
    });
  }

  acceptTerms(userId: string, ip?: string, userAgent?: string) {
    return this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        ...termsAcceptance(ip),
        ...termsAcceptanceLog('gate', ip, userAgent),
      },
      select: {
        id: true,
      },
    });
  }

  async getEmailNotifications(userId: string) {
    return this._user.model.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        sendSuccessEmails: true,
        sendFailureEmails: true,
        sendStreakEmails: true,
      },
    });
  }

  async updateEmailNotifications(userId: string, body: EmailNotificationsDto) {
    await this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        sendSuccessEmails: body.sendSuccessEmails,
        sendFailureEmails: body.sendFailureEmails,
        sendStreakEmails: body.sendStreakEmails,
      },
    });
  }
}
