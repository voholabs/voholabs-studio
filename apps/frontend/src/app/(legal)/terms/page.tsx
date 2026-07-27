import { Metadata } from 'next';
import { LegalPage, LegalSection, LegalList } from '../legal.layout';

export const metadata: Metadata = {
  title: 'Voholabs Studio Terms of Service',
  description:
    'The terms governing use of Voholabs Studio, the social media scheduling and publishing service operated by Voholabs Ltd.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Voholabs Studio Terms of Service"
      updated="27 July 2026"
      intro={
        <>
          These terms govern your use of Voholabs Studio, the social media
          scheduling and publishing service operated by Voholabs Ltd at
          studio.voholabs.com. By creating an account or using the service you
          agree to be bound by them.
        </>
      }
    >
      <LegalSection id="about" title="1. About us">
        <p>
          Voholabs Studio is provided by Voholabs Ltd, a company incorporated in
          England and Wales. You can contact us at{' '}
          <a className="underline" href="mailto:hello@voholabs.com">
            hello@voholabs.com
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="service" title="2. The service">
        <p>
          Voholabs Studio lets you connect social media accounts, compose posts,
          schedule them to publish at chosen times, manage a shared media
          library, collaborate with team members, and view analytics for the
          content you published through the service.
        </p>
      </LegalSection>

      <LegalSection id="eligibility" title="3. Eligibility and accounts">
        <LegalList
          items={[
            <>
              You must be at least 18 years old, or the minimum age required by
              the platforms you connect, whichever is higher.
            </>,
            <>
              You are responsible for keeping your credentials secure and for
              all activity under your account.
            </>,
            <>
              You must give accurate registration details and keep them up to
              date.
            </>,
            <>
              If you add team members, you are responsible for their use of the
              service.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="channels" title="4. Connected channels">
        <p>
          Connecting a channel authorises Voholabs Studio to act on your behalf
          on that platform, strictly within the permissions you granted. You
          confirm that you own or are authorised to manage every account you
          connect.
        </p>
        <p>
          Your use of each connected platform remains subject to that
          platform&apos;s own terms and policies. In particular:
        </p>
        <LegalList
          items={[
            <>
              Where you connect a <strong>TikTok</strong> account, TikTok&apos;s
              Terms of Service, Community Guidelines and Privacy Policy apply.
            </>,
            <>
              Where you connect a <strong>YouTube</strong> channel, you are
              additionally bound by the{' '}
              <a
                className="underline"
                href="https://www.youtube.com/t/terms"
                target="_blank"
                rel="noreferrer"
              >
                YouTube Terms of Service
              </a>
              . Voholabs Studio uses the YouTube API Services, and Google&apos;s
              handling of your data is described in the{' '}
              <a
                className="underline"
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noreferrer"
              >
                Google Privacy Policy
              </a>
              . You can revoke our access to your Google data at any time from{' '}
              <a
                className="underline"
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer"
              >
                Google account permissions
              </a>
              .
            </>,
            <>
              Where you connect a <strong>Facebook</strong> Page,{' '}
              <strong>Instagram</strong> professional account or{' '}
              <strong>Threads</strong> profile, Meta&apos;s Terms of Service,
              Community Standards and{' '}
              <a
                className="underline"
                href="https://www.facebook.com/privacy/policy/"
                target="_blank"
                rel="noreferrer"
              >
                Privacy Policy
              </a>{' '}
              apply.
            </>,
          ]}
        />
        <p>
          Voholabs Studio is an independent product. It is not endorsed by,
          affiliated with, or sponsored by TikTok, Google, YouTube, Meta
          Platforms, Inc. or any other platform, and platform names and logos
          are the trademarks of their respective owners. Platforms may change,
          rate-limit, suspend or withdraw their APIs at any time, and we are not
          liable for a failed or delayed publication caused by a platform
          outage, policy change or account restriction outside our control.
        </p>
      </LegalSection>

      <LegalSection id="content" title="5. Your content">
        <p>
          You retain ownership of everything you upload or schedule. You grant
          us a limited licence to host, process, transform and transmit that
          content solely to operate the service and publish it to the channels
          you selected. You are responsible for ensuring you hold the rights to
          the content you publish.
        </p>
      </LegalSection>

      <LegalSection id="aup" title="6. Acceptable use">
        <p>You must not use Voholabs Studio to:</p>
        <LegalList
          items={[
            <>
              Publish unlawful, infringing, deceptive, harassing or hateful
              content, or content that breaches a connected platform&apos;s
              community guidelines.
            </>,
            <>
              Send spam, operate inauthentic or coordinated networks of
              accounts, or artificially inflate engagement.
            </>,
            <>
              Access accounts you are not authorised to manage, or resell
              platform data obtained through the service.
            </>,
            <>
              Circumvent rate limits, reverse engineer the service, or interfere
              with its security or availability.
            </>,
          ]}
        />
        <p>
          We may suspend or terminate an account that breaches these rules, and
          may be required to do so by a connected platform.
        </p>
      </LegalSection>

      <LegalSection id="billing" title="7. Subscriptions and billing">
        <p>
          Paid plans are billed in advance through Stripe on the cycle shown at
          checkout and renew automatically until cancelled. You can cancel at
          any time from the billing screen; cancellation takes effect at the end
          of the current period, and fees already paid are non-refundable except
          where required by law.
        </p>
      </LegalSection>

      <LegalSection id="availability" title="8. Availability">
        <p>
          We work to keep the service available but do not guarantee
          uninterrupted operation. We may carry out maintenance, and may change
          or discontinue features. Where a change materially reduces the service
          on a paid plan, we will give reasonable notice.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="9. Liability">
        <p>
          Nothing in these terms limits liability for death or personal injury
          caused by negligence, for fraud, or for any liability that cannot
          lawfully be limited. Subject to that, the service is provided as is,
          and our total liability arising out of or in connection with these
          terms is limited to the fees you paid in the twelve months before the
          claim. We are not liable for indirect or consequential loss, or for
          loss of profit, revenue, goodwill or data.
        </p>
      </LegalSection>

      <LegalSection id="termination" title="10. Termination">
        <p>
          You may stop using the service and delete your account at any time. We
          may suspend or terminate access for a material breach of these terms,
          for non-payment, or where required by law or by a connected platform.
          On termination we delete your data in line with the{' '}
          <a className="underline" href="/privacy">
            Voholabs Studio Privacy Policy
          </a>
          . You can delete your account, disconnect an individual channel, or
          ask us to erase your data at any time — the steps are set out in{' '}
          <a className="underline" href="/privacy#data-deletion">
            section 10 of the Privacy Policy
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="changes" title="11. Changes and governing law">
        <p>
          We may update these terms; the date at the top of this page shows when
          they last changed, and we will notify account holders by email of any
          material change. These terms are governed by the laws of England and
          Wales, and the courts of England and Wales have exclusive
          jurisdiction.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
