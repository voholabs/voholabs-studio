import { Metadata } from 'next';
import { ReactNode } from 'react';
import { LegalPage, LegalSection, LegalList } from '../legal.layout';

export const metadata: Metadata = {
  title: 'Voholabs Studio Terms of Service',
  description:
    'The terms governing use of Voholabs Studio, the free social media scheduling and publishing service operated by Voholabs Ltd.',
  alternates: { canonical: '/terms' },
};

// DRAFT FOR OWNER REVIEW. Anything in [SQUARE BRACKETS] is a fact or a decision
// only the owner can supply. Do not publish until every bracket is resolved.

const Ext = ({ href, children }: { href: string; children: ReactNode }) => (
  <a className="underline" href={href} target="_blank" rel="noreferrer">
    {children}
  </a>
);

export default function TermsPage() {
  return (
    <LegalPage
      title="Voholabs Studio Terms of Service"
      updated="[DATE OF PUBLICATION]"
      intro={
        <>
          These terms govern your use of Voholabs Studio, the social media
          scheduling and publishing service operated by Voholabs Ltd at
          studio.voholabs.com. By creating an account or using the service,
          including through the API or an AI assistant, you agree to them. If
          you use the service for a company or other organisation, you agree to
          them on its behalf and confirm you are allowed to do so.
        </>
      }
    >
      <LegalSection id="about" title="1. About us">
        <p>
          Voholabs Studio is provided by Voholabs Ltd, a company registered in
          England and Wales with company number [COMPANY NUMBER], whose
          registered office is at [REGISTERED OFFICE ADDRESS]. [VAT NUMBER, IF
          REGISTERED.] You can contact us at{' '}
          <a className="underline" href="mailto:hello@voholabs.com">
            hello@voholabs.com
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="service" title="2. The service and who it is for">
        <p>
          Voholabs Studio lets you connect social media accounts, compose posts,
          schedule them to publish at chosen times, manage a shared media
          library, work with team members, connect the API, webhooks or an AI
          assistant, and view analytics for the content you published through
          the service.
        </p>
        <p>
          Voholabs Studio is a tool for businesses and professionals. By using
          it you confirm that you are acting for purposes relating to your
          trade, business, craft or profession, and not as a consumer.
        </p>
      </LegalSection>

      <LegalSection id="free-plan" title="3. The free plan">
        <p>
          Scheduling in Voholabs Studio is free. The free plan has no set limit
          on connected channels or scheduled posts, and includes the calendar,
          team members, up to 30 webhooks, the public API and the MCP connection
          for AI assistants. We do not ask for a card.
        </p>
        <p>The free plan has limits you should know about:</p>
        <LegalList
          items={[
            <>
              <strong>Storage.</strong> Each organisation can keep up to 2 GB in
              its media library. When you reach the cap, new uploads are refused
              until you delete files. If you need more, email us and we will
              tell you what is possible.
            </>,
            <>
              <strong>Fair use.</strong> &quot;No set limit&quot; means we do
              not count your channels or posts. It does not mean unlimited load.
              We apply rate limits to the API and the MCP connection, each
              social network applies its own posting limits, and we may restrict
              an account whose usage degrades the service for others.
            </>,
            <>
              <strong>Networks.</strong> Which social networks can be connected
              depends on the approvals each network has given us, and can
              change.
            </>,
            <>
              <strong>Community hosted.</strong> The free plan comes with no
              service level, no uptime commitment and no guaranteed support. We
              fix problems at our own pace. You can report a problem by email or
              on the public repository, but we do not promise a reply or a fix
              by any particular time.
            </>,
            <>
              <strong>It can change.</strong> We may change, limit or withdraw
              the free plan, or any feature in it. If we withdraw it, or make a
              change that materially reduces it, we will give account holders at
              least [30] days&apos; notice by email where we reasonably can, so
              you can copy your content out first.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="paid" title="4. Paid features and Apex">
        <p>
          AI features (writing, image and video generation, the agent and the
          brief) are not part of the free plan. They are available only as part
          of Apex, the managed content service sold by Voholabs Ltd at
          voholabs.com.
        </p>
        <p>
          Apex is ordered, billed and cancelled through voholabs.com, with
          payment taken by Stripe. Apex fees, renewal, cancellation and refunds
          are governed by the{' '}
          <Ext href="https://voholabs.com/terms">Voholabs Terms of Service</Ext>{' '}
          and <Ext href="https://voholabs.com/refund-policy">Refund Policy</Ext>
          , not by this page. These Studio terms continue to govern your use of
          Voholabs Studio itself. If an Apex subscription ends, your Studio
          organisation returns to the free plan and its limits, including the 2
          GB storage cap.
        </p>
      </LegalSection>

      <LegalSection id="eligibility" title="5. Eligibility and accounts">
        <LegalList
          items={[
            <>
              You must be at least 18 years old, or the minimum age required by
              the platforms you connect, whichever is higher.
            </>,
            <>
              You can sign up with Google, or with a work email address and a
              password. We ask every new account a few questions about who you
              are and how you plan to use Studio. Our{' '}
              <a className="underline" href="/privacy">
                Privacy Policy
              </a>{' '}
              explains how we use the answers, including to contact you about
              Voholabs services.
            </>,
            <>
              You must give accurate registration details and keep them up to
              date.
            </>,
            <>
              You are responsible for keeping your password, API keys and AI
              assistant connections secure, and for all activity under your
              account, including activity by anyone or anything you give access
              to.
            </>,
            <>
              If you add team members, you are responsible for their use of the
              service and for telling them how their data is handled.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="channels" title="6. Connected channels">
        <p>
          Connecting a channel authorises Voholabs Studio to act on your behalf
          on that platform, strictly within the permissions you granted. You
          confirm that you own or are authorised to manage every account you
          connect.
        </p>
        <p>
          Your use of each connected platform remains subject to that
          platform&apos;s own terms and policies, and you are responsible for
          complying with them. In particular:
        </p>
        <LegalList
          items={[
            <>
              Where you connect a <strong>TikTok</strong> account, TikTok&apos;s
              Terms of Service, Community Guidelines and Privacy Policy apply.
            </>,
            <>
              Where you connect a <strong>YouTube</strong> channel, you agree to
              be bound by the{' '}
              <Ext href="https://www.youtube.com/t/terms">
                YouTube Terms of Service
              </Ext>
              . Voholabs Studio uses the YouTube API Services, and Google&apos;s
              handling of your data is described in the{' '}
              <Ext href="https://policies.google.com/privacy">
                Google Privacy Policy
              </Ext>
              . You can revoke our access to your Google data at any time from
              the{' '}
              <Ext href="https://security.google.com/settings/security/permissions">
                Google security settings page
              </Ext>
              .
            </>,
            <>
              Where you connect a <strong>Facebook</strong> Page,{' '}
              <strong>Instagram</strong> professional account or{' '}
              <strong>Threads</strong> profile, Meta&apos;s Terms of Service,
              Community Standards and{' '}
              <Ext href="https://www.facebook.com/privacy/policy/">
                Privacy Policy
              </Ext>{' '}
              apply.
            </>,
            <>
              Where you connect a <strong>LinkedIn</strong> profile or page, the
              LinkedIn User Agreement and Professional Community Policies apply.
              Where you connect an <strong>X</strong> account, the X Terms of
              Service and X Rules apply, including the rules on automation.
            </>,
          ]}
        />
        <p>
          Voholabs Studio is an independent product. It is not endorsed by,
          affiliated with, or sponsored by TikTok, Google, YouTube, Meta
          Platforms, Inc., LinkedIn, X Corp. or any other platform, and platform
          names and logos are the trade marks of their respective owners.
          Platforms may change, rate-limit, suspend or withdraw their APIs or
          our access to them at any time.
        </p>
      </LegalSection>

      <LegalSection id="content" title="7. Your content">
        <p>
          You keep ownership of everything you upload or schedule. You grant us
          a non-exclusive, worldwide, royalty-free licence to host, store, copy,
          process, transform (for example resizing or re-encoding media) and
          transmit that content, only as needed to operate the service and
          publish it to the channels you selected. The licence ends when the
          content is deleted from our systems.
        </p>
        <p>
          You are responsible for your content: that you hold the rights to it,
          that it is lawful, that it is properly labelled where a platform or
          the law requires a label (for example advertising, paid partnerships
          or AI-generated media), and that it complies with the rules of every
          platform you publish it to. We do not review content before it is
          published.
        </p>
      </LegalSection>

      <LegalSection id="automation" title="8. The API, MCP and AI assistants">
        <p>
          You can operate Voholabs Studio through the public API, webhooks, and
          an MCP connection that lets an AI assistant act in your account. These
          are powerful, so please read this section carefully.
        </p>
        <LegalList
          items={[
            <>
              Anything done with your API key or through an AI assistant you
              connected is treated as done by you. That includes posts an
              assistant writes, schedules, edits, deletes or publishes, even if
              it misunderstood you or acted without asking.
            </>,
            <>
              An AI assistant you connect can read data in your organisation,
              including channel names, posts, media and analytics, and that data
              is then handled by the provider of that assistant under their
              terms, not ours. Only connect assistants you trust.
            </>,
            <>
              You use the API, webhooks and AI assistants at your own risk. We
              are not responsible for what an assistant, script or third-party
              tool does with the access you gave it. If you want a human check
              before anything goes out, have the assistant create drafts and
              publish them yourself.
            </>,
            <>
              We may rate-limit, suspend or revoke API keys and MCP connections
              to protect the service or a connected platform.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="aup" title="9. Acceptable use">
        <p>
          You must not use Voholabs Studio, directly or through automation, to:
        </p>
        <LegalList
          items={[
            <>
              Publish unlawful, infringing, defamatory, deceptive, harassing or
              hateful content, or content that breaches a connected
              platform&apos;s rules or community guidelines.
            </>,
            <>
              Send spam, post duplicate or near-duplicate content across many
              accounts, operate inauthentic or coordinated networks of accounts,
              or artificially inflate engagement.
            </>,
            <>
              Access accounts you are not authorised to manage, or scrape,
              resell or build databases from platform data obtained through the
              service.
            </>,
            <>
              Get around rate limits or storage limits (for example by opening
              multiple organisations to avoid the storage cap), use the media
              library as general file hosting, probe or attack the service, or
              interfere with its security or availability.
            </>,
            <>
              Upload malware, or content that is illegal to possess or
              distribute.
            </>,
          ]}
        />
        <p>
          We may remove content, pause scheduled posts, and suspend or close an
          account that we reasonably believe breaches these rules, and we may be
          required to do so by a connected platform. Where we reasonably can, we
          will tell you why.
        </p>
      </LegalSection>

      <LegalSection id="reliability" title="10. Scheduled posts can fail">
        <p>
          Publishing depends on our systems, on each platform&apos;s API and on
          the state of your connected account, so we cannot promise that every
          post goes out, or goes out on time. A scheduled post may fail, be
          delayed, be published more than once, or be published with missing
          media or formatting, for example because a platform is down or changes
          its API, a token has expired, a platform rejects the content, or our
          own service has a fault or is being maintained.
        </p>
        <p>
          You are responsible for checking that important posts were published
          as you intended, and for keeping your own copy of your content. Do not
          rely on Voholabs Studio as the only means of publishing anything that
          is time-critical or legally required. Our liability for failed, late
          or duplicated posts is limited as set out in section 13.
        </p>
      </LegalSection>

      <LegalSection id="availability" title="11. Availability and support">
        <p>
          We work to keep the service running but do not guarantee uninterrupted
          or error-free operation. We may carry out maintenance, and may change
          or discontinue features. We do not commit to any support response
          time. Where a change materially reduces a paid service, the notice we
          give is set out in the terms for that paid service.
        </p>
      </LegalSection>

      <LegalSection id="open-source" title="12. Open source">
        <p>
          Voholabs Studio is built on open-source software licensed under the
          GNU Affero General Public License, version 3 (AGPL-3.0). The complete
          source code of the version running at studio.voholabs.com, including
          our modifications and the copyright and licence notices of the
          original authors, is available at{' '}
          <Ext href="https://github.com/voholabs/voholabs-studio">
            github.com/voholabs/voholabs-studio
          </Ext>
          . The AGPL-3.0 governs your rights in the source code. These terms
          govern your use of the hosted service we run. Nothing in these terms
          limits the rights the AGPL-3.0 gives you in the code.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="13. Liability">
        <p>
          Nothing in these terms limits liability for death or personal injury
          caused by negligence, for fraud or fraudulent misrepresentation, or
          for any liability that cannot lawfully be limited.
        </p>
        <p>
          Subject to that, the service is provided as is and as available. We
          give no warranty that it will be uninterrupted, error free, or fit for
          a particular purpose, and all implied terms are excluded as far as the
          law allows.
        </p>
        <p>
          Subject to the first paragraph, we are not liable for: loss of profit,
          revenue, business, contracts, goodwill or reputation; loss of or
          damage to data or content; the suspension, restriction or closure of
          any of your accounts by a platform; failed, late, duplicated or
          incorrectly published posts; anything done by an AI assistant, script
          or third-party tool you connected; or any indirect or consequential
          loss.
        </p>
        <p>
          Subject to the first paragraph, our total liability arising out of or
          in connection with these terms and the service, however it arises, is
          limited to the greater of (a) the fees you paid us for Voholabs Studio
          in the twelve months before the claim arose and (b) £100.
        </p>
        <p>
          The free plan costs you nothing, and these limits reflect that. If
          they do not suit your business, do not rely on the free plan for
          anything critical.
        </p>
      </LegalSection>

      <LegalSection id="indemnity" title="14. Claims caused by your use">
        <p>
          If someone brings a claim against us because of content you published,
          accounts you connected without authority, your breach of a
          platform&apos;s rules or of section 9, or personal data you put into
          the service without a lawful basis, you will reimburse us for the
          reasonable losses and costs we incur as a result. We will tell you
          about the claim promptly and will not settle it without talking to you
          first.
        </p>
      </LegalSection>

      <LegalSection id="data" title="15. Personal data you put into Studio">
        <p>
          Our{' '}
          <a className="underline" href="/privacy">
            Privacy Policy
          </a>{' '}
          explains how we handle your own account data as a controller. Where
          the content, media or team member details you put into Studio include
          personal data about other people, you are the controller of that data
          and we process it for you as a processor. For that processing we agree
          that we will:
        </p>
        <LegalList
          items={[
            <>
              process it only on your documented instructions, which are these
              terms and what you do in the service, unless the law requires
              otherwise;
            </>,
            <>
              keep it confidential and make sure everyone we authorise to handle
              it is bound to do the same;
            </>,
            <>
              apply appropriate technical and organisational security measures;
            </>,
            <>
              use the sub-processors listed in the Privacy Policy under written
              terms that protect the data to the same standard, tell you before
              we add or replace one by updating that list, and remain
              responsible for them;
            </>,
            <>
              help you, as far as is reasonable, to respond to requests from
              individuals and to meet your own security, breach notification and
              impact assessment duties, and tell you without undue delay if we
              become aware of a personal data breach affecting your data;
            </>,
            <>
              delete the data when your account is closed, as described in the
              Privacy Policy, unless the law requires us to keep it; and
            </>,
            <>
              give you the information reasonably needed to show we meet these
              obligations.
            </>,
          ]}
        />
        <p>
          You confirm that you have a lawful basis and any notices or consents
          needed to put that data into Studio and publish it.
        </p>
      </LegalSection>

      <LegalSection id="feedback" title="16. Feedback">
        <p>
          If you send us ideas or suggestions about the service, we may use them
          without restriction or payment. Contributions to the source code are
          made under the terms stated in the repository.
        </p>
      </LegalSection>

      <LegalSection id="termination" title="17. Ending your account">
        <p>
          You can stop using the service at any time. There is currently no
          button to delete your own account: to close it, email{' '}
          <a className="underline" href="mailto:hello@voholabs.com">
            hello@voholabs.com
          </a>{' '}
          from the address registered on the account, and we will close it and
          delete your data as set out in{' '}
          <a className="underline" href="/privacy#data-deletion">
            section 11 of the Privacy Policy
          </a>
          .
        </p>
        <p>
          We may suspend or close an account for a material breach of these
          terms, where required by law or by a connected platform, or if we
          withdraw the service under section 3. We may also close an account
          that has not been used for 12 months, after emailing a warning to the
          registered address at least 30 days before.
        </p>
        <p>
          You can copy your posts and media out through the app or the API while
          your account is open. We do not provide an export after an account is
          closed, so take what you need first. Sections 7, 8, 13, 14 and 18
          continue to apply after your account ends.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="18. Changes and governing law">
        <p>
          We may update these terms. The date at the top of this page shows when
          they last changed, and we will email account holders about any
          material change at least 14 days before it takes effect, unless the
          change is needed sooner for legal or security reasons. If you keep
          using the service after a change takes effect, you accept the updated
          terms. If you do not accept them, stop using the service and ask us to
          close your account.
        </p>
        <p>
          These terms, and any dispute or claim arising out of them or the
          service (including non-contractual disputes), are governed by the laws
          of England and Wales, and the courts of England and Wales have
          exclusive jurisdiction.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
