import { Injectable } from '@nestjs/common';
import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { TemporalService } from 'nestjs-temporal-core';
import { TypedSearchAttributes } from '@temporalio/common';
import { organizationId } from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';

export type NotificationType = 'success' | 'fail' | 'info';

@Injectable()
export class NotificationService {
  constructor(
    private _notificationRepository: NotificationsRepository,
    private _emailService: EmailService,
    private _organizationRepository: OrganizationRepository,
    private _temporalService: TemporalService
  ) {}

  getMainPageCount(organizationId: string, userId: string) {
    return this._notificationRepository.getMainPageCount(
      organizationId,
      userId
    );
  }

  getNotificationsPaginated(organizationId: string, page: number) {
    return this._notificationRepository.getNotificationsPaginated(
      organizationId,
      page
    );
  }

  getNotifications(organizationId: string, userId: string) {
    return this._notificationRepository.getNotifications(
      organizationId,
      userId
    );
  }

  async inAppNotification(
    orgId: string,
    subject: string,
    message: string,
    sendEmail = false,
    digest = false,
    type: NotificationType = 'success'
  ) {
    await this._notificationRepository.createNotification(orgId, message);
    if (!sendEmail) {
      return;
    }

    if (digest) {
      try {
        await this._temporalService.client
          .getRawClient()
          ?.workflow.signalWithStart('digestEmailWorkflow', {
            workflowId: 'digest_email_workflow_' + orgId,
            signal: 'email',
            signalArgs: [
              [
                {
                  title: subject,
                  message,
                  type,
                },
              ],
            ],
            taskQueue: 'main',
            workflowIdConflictPolicy: 'USE_EXISTING',
            args: [{ organizationId: orgId }],
            typedSearchAttributes: new TypedSearchAttributes([
              {
                key: organizationId,
                value: orgId,
              },
            ]),
          });
      } catch (err) {}

      return;
    }

    await this.sendEmailsToOrg(orgId, subject, message, type);
  }

  async sendEmailsToOrg(
    orgId: string,
    subject: string,
    message: string,
    type?: NotificationType
  ) {
    const userOrg = await this._organizationRepository.getAllUsersOrgs(orgId);
    for (const user of userOrg?.users || []) {
      // 'info' type is always sent regardless of preferences
      if (type !== 'info') {
        // Filter users based on their email preferences
        if (type === 'success' && !user.user.sendSuccessEmails) {
          continue;
        }
        if (type === 'fail' && !user.user.sendFailureEmails) {
          continue;
        }
      }
      await this.sendEmail(user.user.email, subject, message);
    }
  }

  async sendEmail(to: string, subject: string, html: string, replyTo?: string) {
    await this._emailService.sendEmail(to, subject, html, 'top', replyTo);
  }

  hasEmailProvider() {
    return this._emailService.hasProvider();
  }

  // Email the team. This is the only path an agent has to send mail, and the
  // address list is never taken from the caller: it is read from the
  // organization and any address that is not on it is dropped. An agent with a
  // key for one team therefore cannot reach anybody outside that team, whatever
  // it is asked or talked into sending.
  //
  // Delivery preferences are not consulted. sendSuccessEmails and
  // sendFailureEmails govern automated post-result mail; this is someone
  // deliberately writing to their colleagues, which is closer to the 'info'
  // type that already ignores them.
  async notifyTeam(
    orgId: string,
    subject: string,
    message: string,
    only?: string[]
  ): Promise<{
    sent: string[];
    rejected: string[];
    delivered: boolean;
  }> {
    const organization = await this._organizationRepository.getAllUsersOrgs(
      orgId
    );

    const members = (organization?.users || []).map((one) =>
      one.user.email.trim().toLowerCase()
    );

    // No list means everyone on the team. A list is treated as a filter over
    // the members, never as a set of addresses to send to — so an address that
    // is not a member cannot survive this step.
    const requested = (only || []).map((email) => email.trim().toLowerCase());
    const recipients = only?.length
      ? members.filter((email) => requested.includes(email))
      : members;
    const rejected = requested.filter((email) => !members.includes(email));

    const delivered = this.hasEmailProvider() && !!recipients.length;
    if (delivered) {
      const html = this.asEmailBody(message);
      for (const email of recipients) {
        await this.sendEmail(email, subject, html);
      }

      // Leaves a trace in the bell as well, so a mail the agent sent is
      // visible to someone who never opens their inbox.
      await this._notificationRepository.createNotification(orgId, subject);
    }

    return { sent: recipients, rejected, delivered };
  }

  // The agent writes plain text and this turns it into the body of an email.
  // It is escaped rather than trusted: the text can quote a customer, a post
  // or a web page, and none of those should be able to put markup in mail the
  // team receives.
  private asEmailBody(message: string) {
    const escaped = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    return escaped
      .split(/\n{2,}/)
      .map(
        (paragraph) =>
          `<p style="margin: 0 0 1rem; line-height: 1.6;">${paragraph.replace(
            /\n/g,
            '<br />'
          )}</p>`
      )
      .join('');
  }
}
