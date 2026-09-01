import { Resend } from 'resend';
import { EmailInterface } from '@gitroom/nestjs-libraries/emails/email.interface';

const resend = new Resend(process.env.RESEND_API_KEY || 're_132');

export class ResendProvider implements EmailInterface {
  name = 'resend';
  validateEnvKeys = ['RESEND_API_KEY'];
  async sendEmail(
    to: string,
    subject: string,
    html: string,
    emailFromName: string,
    emailFromAddress: string,
    replyTo?: string
  ) {
    const sends = await resend.emails.send({
      from: `${emailFromName} <${emailFromAddress}>`,
      to,
      subject,
      html,
      ...(replyTo && { reply_to: replyTo }),
    });

    // The Resend SDK resolves with `{ data: null, error }` instead of throwing,
    // so an unverified domain or a bad key looks identical to a delivered email
    // unless we surface it ourselves.
    if (sends.error) {
      throw new Error(
        `Resend refused the email: ${sends.error.name} - ${sends.error.message}`
      );
    }

    return sends;
  }
}
