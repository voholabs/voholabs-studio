import { TutorialProgressDto } from '@gitroom/nestjs-libraries/dtos/users/tutorial-progress.dto';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { UsersRepository } from '@gitroom/nestjs-libraries/database/prisma/users/users.repository';
import { Provider, Role } from '@prisma/client';
import { UserDetailDto } from '@gitroom/nestjs-libraries/dtos/users/user.details.dto';
import { OnboardingDto } from '@gitroom/nestjs-libraries/dtos/users/onboarding.dto';
import { EmailNotificationsDto } from '@gitroom/nestjs-libraries/dtos/users/email-notifications.dto';
import { TimezoneDto } from '@gitroom/nestjs-libraries/dtos/users/timezone.dto';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { AgentConnectionService } from '@gitroom/nestjs-libraries/database/prisma/agent-connections/agent-connection.service';
import { BriefService } from '@gitroom/nestjs-libraries/database/prisma/brief/brief.service';
import { WalletPlusService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.plus.service';
import { closedAccountMessage } from '@gitroom/nestjs-libraries/database/prisma/users/terms';

// The UTC day each person was last recorded active by this process, so the
// table is written once a day per person rather than on every request.
const activeToday = new Map<string, string>();

@Injectable()
export class UsersService {
  constructor(
    private _usersRepository: UsersRepository,
    private _organizationRepository: OrganizationRepository,
    private _integrationRepository: IntegrationRepository,
    private _notificationService: NotificationService,
    private _agentConnectionService: AgentConnectionService,
    private _briefService: BriefService,
    private _walletPlusService: WalletPlusService
  ) {}

  private readonly _logger = new Logger(UsersService.name);

  getProviderUserByEmail(email: string, providers: Provider[]) {
    return this._usersRepository.getProviderUserByEmail(email, providers);
  }

  // An address whose account we closed for abuse cannot sign up or sign in
  // again, with a password or through a provider. The plain Error is what the
  // sign-in forms show.
  async assertNotBanned(email?: string | null) {
    if (email && (await this._usersRepository.isEmailBanned(email))) {
      throw new Error(closedAccountMessage());
    }
  }

  getUserByEmail(email: string) {
    return this._usersRepository.getUserByEmail(email);
  }

  /** Any provider. See the repository method for why this is separate. */
  getUserByEmailAnyProvider(email: string) {
    return this._usersRepository.getUserByEmailAnyProvider(email);
  }

  getUserById(id: string) {
    return this._usersRepository.getUserById(id);
  }

  getUserWithActiveSubscriptionByEmail(email: string, excludeUserId: string) {
    return this._usersRepository.getUserWithActiveSubscriptionByEmail(
      email,
      excludeUserId
    );
  }

  getImpersonateUser(name: string) {
    return this._organizationRepository.getImpersonateUser(name);
  }

  getUserByProvider(providerId: string, provider: Provider) {
    return this._usersRepository.getUserByProvider(providerId, provider);
  }

  async switchUser(
    currentUserId: string,
    targetUserId: string,
    adminId: string
  ) {
    const { kept, switched } =
      await this._usersRepository.switchUserCredentials(
        currentUserId,
        targetUserId
      );

    this._logger.log(
      `User login switch performed by admin ${adminId}: account ${
        kept.id
      } login ${switched.email} -> ${kept.email}; account ${
        switched.id
      } login ${kept.email} -> ${switched.email}`
    );

    // the swap is already committed; a notification failure must not fail it
    if (this._notificationService.hasEmailProvider()) {
      await Promise.all(
        [kept, switched].map((account) =>
          this._notificationService
            .sendEmail(
              account.email,
              'Your Studio login was changed',
              `An administrator changed the login for your Studio account. ` +
                `You can now sign in using ${account.email}. ` +
                `Your subscription and plan were not changed by this switch — ` +
                `if you intended to cancel a subscription, please do that ` +
                `separately from your billing settings.`
            )
            .catch((err) =>
              this._logger.error(`Failed to notify ${account.email}`, err)
            )
        )
      );
    }

    return { kept, switched };
  }

  async getOrgsToDeleteForAccount(userId: string) {
    const orgs = await this._organizationRepository.getOrgsByUserId(userId);
    const ownedOrgs = orgs.filter(
      (org) => org.users[0].role === Role.SUPERADMIN
    );

    const teams = await Promise.all(
      ownedOrgs.map((org) => this._organizationRepository.getTeam(org.id))
    );

    return ownedOrgs.filter(
      (org, index) =>
        !teams[index]?.users?.some(
          (member) =>
            member.user.id !== userId && member.role === Role.SUPERADMIN
        )
    );
  }

  async getDeleteAccountInfo(userId: string) {
    const ownedOrgs = await this.getOrgsToDeleteForAccount(userId);
    const teams = await Promise.all(
      ownedOrgs.map((org) => this._organizationRepository.getTeam(org.id))
    );

    return {
      hasSubscription: ownedOrgs.some((org) => !!org.subscription),
      hasAdditionalMembers: teams.some((team) =>
        team?.users?.some((member) => member.user.id !== userId)
      ),
    };
  }

  async deleteAccount(userId: string) {
    const deletedOrgs = await this.getOrgsToDeleteForAccount(userId);
    const orgs = await this._organizationRepository.getOrgsByUserId(userId);

    for (const org of orgs) {
      if (deletedOrgs.some((deletedOrg) => deletedOrg.id === org.id)) {
        const team = await this._organizationRepository.getTeam(org.id);
        for (const member of team?.users || []) {
          if (member.user.id !== userId) {
            await this._organizationRepository.deleteTeamMember(
              org.id,
              member.user.id
            );
          }
        }

        await this._integrationRepository.deleteIntegrationsForAccount(org.id);
        await this._organizationRepository.deleteOrganization(org.id);
      } else {
        await this._organizationRepository.deleteTeamMember(org.id, userId);
      }
    }

    await this._usersRepository.deleteAccount(userId);

    this._logger.log(
      `Account ${userId} deleted, organizations removed: ${deletedOrgs
        .map((org) => org.id)
        .join(', ')}`
    );

    return { deletedOrgs };
  }

  // Only the super admin can delete an organization, and only when they keep
  // at least one other organization to land in.
  async getOrgToDelete(userId: string, orgId: string) {
    const orgs = (
      await this._organizationRepository.getOrgsByUserId(userId)
    ).filter((org) => !org.users[0].disabled);
    const org = orgs.find((p) => p.id === orgId);

    if (!org || org.users[0].role !== Role.SUPERADMIN) {
      throw new HttpException(
        'Only the super admin can delete this organization',
        400
      );
    }

    if (orgs.length < 2) {
      throw new HttpException(
        'You cannot delete your only organization',
        400
      );
    }

    const team = await this._organizationRepository.getTeam(org.id);
    if (
      team?.users?.some(
        (member) => member.user.id !== userId && !member.disabled
      )
    ) {
      throw new HttpException(
        'Please remove your team members before deleting this organization',
        400
      );
    }

    return org;
  }

  async deleteOrganization(userId: string, orgId: string) {
    await this.getOrgToDelete(userId, orgId);
    await this._integrationRepository.deleteIntegrationsForAccount(orgId);
    await this._organizationRepository.deleteOrganization(orgId);

    this._logger.log(`Organization ${orgId} deleted by ${userId}`);
  }

  activateUser(id: string) {
    return this._usersRepository.activateUser(id);
  }

  updatePassword(id: string, password: string) {
    return this._usersRepository.updatePassword(id, password);
  }

  getPersonal(userId: string) {
    return this._usersRepository.getPersonal(userId);
  }

  changePersonal(userId: string, body: UserDetailDto) {
    return this._usersRepository.changePersonal(userId, body);
  }

  // The onboarding steps, worked out from the workspace itself: a connected
  // channel, an agent that reached the MCP and the brief's onboarding
  // documents (all three skippable). Only an admin holds the API key an agent
  // connects with, so for anyone else the agent and the brief are not theirs
  // to do.
  async onboardingStatus(organizationId: string) {
    const [integrations, agent, brief] = await Promise.all([
      this._integrationRepository.getIntegrationsList(organizationId),
      this._agentConnectionService.status(organizationId),
      this._briefService.onboardingStatus(organizationId),
    ]);
    return {
      channel: integrations.length > 0,
      agent: agent.connected,
      brief,
    };
  }

  // Every step can be skipped, so reaching the end finishes onboarding, with
  // or without a channel. Finishing gives no credits. The first finish of a
  // free-plan admin starts the Plus early bird (never fails the finish).
  async completeOnboarding(
    userId: string,
    body: OnboardingDto,
    organizationId: string,
    startsEarlyBird: boolean
  ) {
    const { count } = await this._usersRepository.completeOnboarding(
      userId,
      body
    );
    if (count > 0 && startsEarlyBird) {
      await this._walletPlusService.startEarlyBird(organizationId);
    }
  }

  // Counts the person as active today. Never throws and never waits: it runs
  // on every signed-in request.
  markActive(userId: string) {
    const day = new Date().toISOString().slice(0, 10);
    if (activeToday.get(userId) === day) {
      return;
    }
    activeToday.set(userId, day);
    this._usersRepository
      .markActive(userId, new Date(`${day}T00:00:00.000Z`))
      .catch(() => {
        activeToday.delete(userId);
      });
  }

  recordTutorialProgress(userId: string, body: TutorialProgressDto) {
    return this._usersRepository.recordTutorialProgress(userId, body);
  }

  acceptTerms(userId: string, ip?: string, userAgent?: string) {
    return this._usersRepository.acceptTerms(userId, ip, userAgent);
  }

  getEmailNotifications(userId: string) {
    return this._usersRepository.getEmailNotifications(userId);
  }

  updateEmailNotifications(userId: string, body: EmailNotificationsDto) {
    return this._usersRepository.updateEmailNotifications(userId, body);
  }

  updateTimezone(userId: string, body: TimezoneDto) {
    return this._usersRepository.updateTimezone(userId, body);
  }
}
