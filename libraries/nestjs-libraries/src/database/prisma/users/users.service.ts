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
import { WalletService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
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
    private _walletService: WalletService,
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
  // documents (all three skippable), and the welcome credits that doing the
  // agent and filling at least one document of the brief earns. Only an admin holds the API key an agent
  // connects with, so for anyone else the agent and the brief are not theirs
  // to do. The credits are for the free plan only; a paid plan never pays
  // from them.
  async onboardingStatus(
    organizationId: string,
    isAdmin: boolean,
    freePlan: boolean
  ) {
    const [integrations, agent, brief, credits] = await Promise.all([
      this._integrationRepository.getIntegrationsList(organizationId),
      this._agentConnectionService.status(organizationId),
      this._briefService.onboardingStatus(organizationId),
      this._walletService.welcomeCredits(organizationId),
    ]);
    return {
      channel: integrations.length > 0,
      agent: agent.connected,
      brief,
      credits: {
        ...credits,
        eligible:
          freePlan &&
          isAdmin &&
          agent.connected &&
          brief.documents.some((document) => document.filled),
      },
    };
  }

  // Every step can be skipped, so reaching the end finishes onboarding, with
  // or without a channel. Finishing gives nothing: the welcome credits come
  // only from the claim, which checks the agent and the brief again.
  completeOnboarding(userId: string, body: OnboardingDto) {
    return this._usersRepository.completeOnboarding(userId, body);
  }

  // The welcome credits, for a workspace whose agent is connected and has
  // filled at least one document of the brief, and that has not turned them
  // down. Checked here, not in the browser.
  async claimWelcomeCredits(
    organizationId: string,
    isAdmin: boolean,
    freePlan: boolean
  ) {
    const status = await this.onboardingStatus(
      organizationId,
      isAdmin,
      freePlan
    );
    if (status.credits.skipped) {
      throw new HttpException('The welcome credits were turned down', 400);
    }
    if (!status.credits.eligible) {
      throw new HttpException(
        'Connect your agent and let it fill in what it knows first',
        400
      );
    }
    const added = await this._walletService.claimWelcomeCredits(
      organizationId
    );
    // The Plus early bird starts with the claim; its one email is scheduled
    // now (never fails the claim).
    if (added > 0) {
      await this._walletPlusService.startEarlyBird(organizationId);
    }
    return { credits: added / 100 };
  }

  // Turning the welcome credits down in onboarding. Final: they cannot be
  // claimed after it.
  async skipWelcomeCredits(organizationId: string, isAdmin: boolean) {
    if (!isAdmin) {
      throw new HttpException('Only an admin can decide this', 403);
    }
    // Skipping starts the Plus early bird too, as a claim does; its one email
    // is scheduled now (never fails the skip).
    if (await this._walletService.skipWelcomeCredits(organizationId)) {
      await this._walletPlusService.startEarlyBird(organizationId);
    }
  }

  // A free-plan admin who finished onboarding before the welcome credits
  // existed is shown the onboarding once more, until the credits are
  // claimed or turned down.
  async welcomeCreditsPending(organizationId: string) {
    return (
      (await this._walletService.welcomeCredits(organizationId)).available > 0
    );
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
