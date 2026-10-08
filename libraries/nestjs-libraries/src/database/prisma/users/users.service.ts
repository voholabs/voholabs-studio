import { TutorialProgressDto } from '@gitroom/nestjs-libraries/dtos/users/tutorial-progress.dto';
import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@gitroom/nestjs-libraries/database/prisma/users/users.repository';
import { Provider } from '@prisma/client';
import { UserDetailDto } from '@gitroom/nestjs-libraries/dtos/users/user.details.dto';
import { OnboardingDto } from '@gitroom/nestjs-libraries/dtos/users/onboarding.dto';
import { EmailNotificationsDto } from '@gitroom/nestjs-libraries/dtos/users/email-notifications.dto';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';

// The UTC day each person was last recorded active by this process, so the
// table is written once a day per person rather than on every request.
const activeToday = new Map<string, string>();

@Injectable()
export class UsersService {
  constructor(
    private _usersRepository: UsersRepository,
    private _organizationRepository: OrganizationRepository
  ) {}

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

  getImpersonateUser(name: string) {
    return this._organizationRepository.getImpersonateUser(name);
  }

  getUserByProvider(providerId: string, provider: Provider) {
    return this._usersRepository.getUserByProvider(providerId, provider);
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

  completeOnboarding(userId: string, body: OnboardingDto) {
    return this._usersRepository.completeOnboarding(userId, body);
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
}
