import { Metadata } from 'next';
import { ReactNode } from 'react';
import { LegalPage, LegalSection, LegalList } from '../legal.layout';

export const metadata: Metadata = {
  title: 'Voholabs Studio Privacy Policy',
  description:
    'How Voholabs Studio collects, uses, shares, stores and deletes personal data, including data obtained from connected social media platforms such as TikTok, YouTube, Facebook, Instagram and Threads.',
  alternates: { canonical: '/privacy' },
};

// DRAFT FOR OWNER REVIEW. Anything in [SQUARE BRACKETS] is a fact or a decision
// only the owner can supply. Do not publish until every bracket is resolved.
//
// Several statements below are commitments the product does not yet keep by
// itself (see the pull request description, "Product fixes"). Until those are
// built, the owner has to carry them out by hand:
//   - erasing the tokens of a removed channel within 30 days
//   - erasing deleted media files from storage within 30 days
//   - closing an account and erasing its data on an emailed request
//
// The #data-deletion anchor is registered with Meta as the data deletion
// instructions URL. Keep the id when editing.

const Ext = ({ href, children }: { href: string; children: ReactNode }) => (
  <a className="underline" href={href} target="_blank" rel="noreferrer">
    {children}
  </a>
);

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Voholabs Studio Privacy Policy"
      updated="[DATE OF PUBLICATION]"
      intro={
        <>
          Voholabs Studio is a social media scheduling and publishing tool
          operated by Voholabs Ltd. This policy explains what personal data
          Voholabs Studio collects, why we collect it, who we share it with, how
          long we keep it, and the rights you have over it. It applies to
          everything at studio.voholabs.com and to the data we obtain from
          social media platforms you choose to connect, including TikTok,
          YouTube, Facebook, Instagram and Threads. The short version: Studio is
          free, and in return we learn who our users are and may contact you
          about Voholabs services. You can say no to that contact at any time
          and keep using Studio. If you are here to delete your data, see{' '}
          <a className="underline" href="#data-deletion">
            section 11, Deleting your data
          </a>
          .
        </>
      }
    >
      <LegalSection id="controller" title="1. Who we are">
        <p>
          The data controller is [LEGAL ENTITY NAME, shown on this site today as
          Voholabs Ltd: confirm the exact registered name], a company registered
          in England and Wales with company number [COMPANY NUMBER], whose
          registered office is at [REGISTERED OFFICE ADDRESS]. We are registered
          with the UK Information Commissioner&apos;s Office under number [ICO
          REGISTRATION NUMBER]. You can reach us about anything in this policy
          at{' '}
          <a className="underline" href="mailto:hello@voholabs.com">
            hello@voholabs.com
          </a>
          .
        </p>
        <p>
          We act as a data controller for your Voholabs Studio account data.
          Where the content you schedule, or the team members you add, include
          personal data about other people, you are the controller of that data
          and we process it for you as a processor, on the terms in section 17
          of the{' '}
          <a className="underline" href="/terms#data">
            Terms of Service
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="data" title="2. Data we collect">
        <p>We collect the following categories of personal data:</p>
        <LegalList
          items={[
            <>
              <strong>Account data:</strong> your name, email address, hashed
              password or Google sign-in identifier, organisation name, and team
              membership. If you sign in with Google we receive your name, email
              address, profile picture and Google account identifier from
              Google, and nothing else.
            </>,
            <>
              <strong>Onboarding answers:</strong> every new account is asked
              for a name, a company website, a role, what you plan to use Studio
              for, and where you heard about us. These questions are mandatory.
              Section 8 explains what we do with the answers.
            </>,
            <>
              <strong>How you found us:</strong> the address of the first Studio
              page you opened, the site that referred you, and any campaign tag
              in the link you followed (for example utm_source). These are saved
              in your browser and stored with your account when you complete
              onboarding.
            </>,
            <>
              <strong>Content data:</strong> the posts, captions, images, videos
              and schedules you create in Voholabs Studio, along with any media
              you upload to the media library.
            </>,
            <>
              <strong>Connected channel data:</strong> access tokens, refresh
              tokens, channel identifiers, profile names, avatars and analytics
              returned by the social media platforms you connect.
            </>,
            <>
              <strong>Access you create:</strong> API keys, webhooks, and the
              connections you authorise for AI assistants.
            </>,
            <>
              <strong>Billing data:</strong> whether your organisation has a
              paid Apex subscription. Payment for Apex is taken on voholabs.com
              by Stripe. Card details never reach Voholabs Studio.
            </>,
            <>
              <strong>Technical data:</strong> the IP address and browser type
              recorded against your account when you register and sign in, and
              error and usage logs generated when you use the service.
            </>,
          ]}
        />
        <p>
          We do not ask for special category data (such as health, religion or
          political opinions), and you should not put it into Studio unless you
          are entitled to publish it.
        </p>
      </LegalSection>

      <LegalSection id="tiktok" title="3. TikTok data: what we access and why">
        <p>
          When you connect a TikTok account to Voholabs Studio, you are taken to
          TikTok&apos;s own login and consent screen. TikTok, not Voholabs
          Studio, authenticates you; we never see or store your TikTok password.
          TikTok then returns an access token that we use strictly within the
          scopes you approved:
        </p>
        <LegalList
          items={[
            <>
              <strong>user.info.basic:</strong> your TikTok open ID, display
              name and avatar, so we can show you which account a post will be
              published to.
            </>,
            <>
              <strong>user.info.profile:</strong> your profile handle, biography
              and profile link, shown in the channel settings and post preview.
            </>,
            <>
              <strong>user.info.stats:</strong> aggregate follower, following,
              like and video counts, shown on the analytics screen.
            </>,
            <>
              <strong>video.list:</strong> metadata for videos already published
              on your account (title, cover image, view, like, comment and share
              counts), used to populate your analytics.
            </>,
            <>
              <strong>video.upload</strong> and <strong>video.publish:</strong>{' '}
              used only to upload and publish the specific videos you have
              created and scheduled inside Voholabs Studio, at the time you
              scheduled them.
            </>,
          ]}
        />
        <p>
          We do not use TikTok data for advertising, profiling, sales outreach,
          credit or insurance decisions, training machine learning models, or
          building audience segments. We do not sell TikTok data. We do not
          share it with anyone other than the providers listed in section 9 that
          host the service on our behalf, and any tool you yourself connect to
          your account (section 7).
        </p>
        <p>
          You can remove a TikTok channel at any time from the launches screen
          in Voholabs Studio (see section 11). Doing so asks TikTok to revoke
          our access token, stops all use of it at once, and we erase the stored
          tokens and cached TikTok profile and analytics data within 30 days.
          You can also revoke access directly from the TikTok app under Settings
          and privacy. Content already published to TikTok remains on TikTok and
          is governed by TikTok&apos;s own policies.
        </p>
        <p>
          Your use of TikTok through Voholabs Studio is also subject to
          TikTok&apos;s Privacy Policy and Terms of Service.
        </p>
      </LegalSection>

      <LegalSection
        id="youtube"
        title="4. YouTube data: what we access and why"
      >
        <p>
          Voholabs Studio uses the YouTube API Services. When you connect a
          YouTube channel, you are taken to Google&apos;s own login and consent
          screen. Google, not Voholabs Studio, authenticates you; we never see
          or store your Google password. Google then returns an access token
          that we use strictly within the scopes you approved:
        </p>
        <LegalList
          items={[
            <>
              <strong>youtube.upload:</strong> used only to upload and publish
              the specific videos you have created and scheduled inside Voholabs
              Studio, at the time you scheduled them, together with the title,
              description, tags, privacy setting, made-for-kids declaration and
              custom thumbnail you entered in our composer.
            </>,
            <>
              <strong>youtube.readonly:</strong> the list of channels you own,
              with their names and avatars, so you can choose which channel to
              publish to and tell your connected channels apart; and the view,
              like and comment counts for videos on your channel, shown on your
              analytics screen. We only read with this scope; we never write.
            </>,
            <>
              <strong>yt-analytics.readonly:</strong> aggregate statistics for
              your own channel (views, estimated minutes watched, average view
              duration, average view percentage, subscribers gained and lost,
              and likes, broken down by day) used to render your analytics
              dashboard.
            </>,
            <>
              <strong>userinfo.profile:</strong> your Google account identifier,
              display name and avatar, read once when you connect, so we can
              label the connected account in your channel list. We do not
              request access to your email address.
            </>,
          ]}
        />
        <p>
          We do not use YouTube data for advertising, profiling, sales outreach,
          credit or insurance decisions, training machine learning models, or
          building audience segments. We do not sell YouTube data. We do not
          share it with anyone other than the providers listed in section 9 that
          host the service on our behalf, and any tool you yourself connect to
          your account (section 7). Our use and transfer of information received
          from Google APIs adheres to the{' '}
          <Ext href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </Ext>
          , including the Limited Use requirements.
        </p>
        <p>
          You can remove a YouTube channel at any time from the launches screen
          in Voholabs Studio (see section 11). Doing so stops all use of the
          token at once, and we erase the stored tokens and cached YouTube
          profile and analytics data within 30 days. You can also revoke our
          access directly from the{' '}
          <Ext href="https://security.google.com/settings/security/permissions">
            Google security settings page
          </Ext>
          . Content already published to YouTube remains on YouTube and is
          governed by YouTube&apos;s own policies.
        </p>
        <p>
          Your use of YouTube through Voholabs Studio is also subject to the{' '}
          <Ext href="https://www.youtube.com/t/terms">
            YouTube Terms of Service
          </Ext>{' '}
          and the{' '}
          <Ext href="https://policies.google.com/privacy">
            Google Privacy Policy
          </Ext>
          .
        </p>
      </LegalSection>

      <LegalSection
        id="meta"
        title="5. Meta data (Facebook, Instagram and Threads): what we access and why"
      >
        <p>
          When you connect a Facebook Page, an Instagram professional account or
          a Threads profile, you are taken to Meta&apos;s own login and consent
          screen. Meta, not Voholabs Studio, authenticates you; we never see or
          store your Facebook, Instagram or Threads password. Meta then returns
          an access token that we use strictly within the permissions you
          approved:
        </p>
        <p>
          <strong>Facebook Pages.</strong> <strong>pages_show_list</strong> and{' '}
          <strong>business_management</strong> to list the Pages you manage so
          you can choose which one to publish to;{' '}
          <strong>pages_manage_posts</strong> to publish the posts you composed
          and scheduled in Voholabs Studio;{' '}
          <strong>pages_manage_engagement</strong> to publish the comments you
          scheduled alongside a post; <strong>pages_read_engagement</strong> and{' '}
          <strong>read_insights</strong> to read back the Page name, avatar and
          the engagement and reach figures shown on your analytics screen.
        </p>
        <p>
          <strong>Instagram.</strong> <strong>instagram_basic</strong> (or{' '}
          <strong>instagram_business_basic</strong> where you connect with
          Instagram Login) to read the account handle, name and avatar so you
          can tell your connected accounts apart;{' '}
          <strong>instagram_content_publish</strong> (or{' '}
          <strong>instagram_business_content_publish</strong>) to publish the
          images, videos, reels and carousels you scheduled;{' '}
          <strong>instagram_manage_comments</strong> (or{' '}
          <strong>instagram_business_manage_comments</strong>) to publish the
          first comment you scheduled with a post; and{' '}
          <strong>instagram_manage_insights</strong> (or{' '}
          <strong>instagram_business_manage_insights</strong>) to read the
          reach, impression, like and comment counts shown on your analytics
          screen.
        </p>
        <p>
          <strong>Threads.</strong> <strong>threads_basic</strong> to read your
          Threads profile handle and avatar;{' '}
          <strong>threads_content_publish</strong> to publish the threads you
          scheduled; <strong>threads_manage_replies</strong> to publish the
          replies you scheduled as part of a thread; and{' '}
          <strong>threads_manage_insights</strong> to read the view, like, reply
          and repost counts shown on your analytics screen.
        </p>
        <p>
          We access this data only to provide the scheduling, publishing and
          analytics features you asked for. We do not use Meta data for
          advertising, profiling, sales outreach, credit or insurance decisions,
          training machine learning models, or building audience segments. We do
          not sell Meta data. We do not share it with anyone other than the
          providers listed in section 9 that host the service on our behalf, and
          any tool you yourself connect to your account (section 7). Our use of
          Meta platform data complies with the{' '}
          <Ext href="https://developers.facebook.com/terms/">
            Meta Platform Terms
          </Ext>{' '}
          and{' '}
          <Ext href="https://developers.facebook.com/devpolicy/">
            Developer Policies
          </Ext>
          .
        </p>
        <p>
          You can remove a Facebook, Instagram or Threads channel at any time
          from the launches screen in Voholabs Studio. Doing so stops all use of
          the token at once, and we erase the stored tokens and cached profile
          and analytics data within 30 days. See section 11 for full deletion
          instructions. You can also revoke our access directly from{' '}
          <Ext href="https://www.facebook.com/settings?tab=business_tools">
            Facebook Settings, Business Integrations
          </Ext>
          . Content already published remains on the platform and is governed by
          Meta&apos;s own policies.
        </p>
        <p>
          Your use of these platforms through Voholabs Studio is also subject to
          the{' '}
          <Ext href="https://www.facebook.com/privacy/policy/">
            Meta Privacy Policy
          </Ext>
          . Voholabs Studio is an independent product and is not endorsed by,
          affiliated with, or sponsored by Meta Platforms, Inc.
        </p>
      </LegalSection>

      <LegalSection id="other-platforms" title="6. Other connected platforms">
        <p>
          The same principles apply to every other channel Voholabs Studio
          supports, including LinkedIn, X, Pinterest, Reddit, Mastodon, Bluesky,
          Discord, Slack and Telegram. In each case we request the narrowest set
          of permissions needed to publish the content you schedule and to read
          back the analytics for the posts you published, we store only the
          tokens and identifiers required to do so, we do not sell the data or
          use it for advertising or sales outreach, and we erase it within 30
          days of you removing the channel. Your use of each platform through
          Voholabs Studio is also subject to that platform&apos;s own terms and
          privacy policy.
        </p>
      </LegalSection>

      <LegalSection id="automation" title="7. AI assistants, the API and Apex">
        <p>
          You can give other tools access to your Studio organisation: an API
          key, a webhook, or an AI assistant connected over MCP. A tool you
          connect can read and change what is in your organisation, including
          channel names, posts, media and analytics from your connected
          platforms. We send it that data because you asked us to. From that
          point the provider of the tool (for example the company behind your AI
          assistant) handles the data under its own terms and privacy policy,
          and we do not control what it does with it. You can cut off a tool at
          any time by rotating your API key in settings.
        </p>
        <p>
          Voholabs Studio&apos;s free plan does not send your content to any AI
          provider. AI features are available only to customers of Apex, our
          paid managed content service. If you are an Apex customer and you use
          an AI feature inside Studio, the text, images, brief and instructions
          you give that feature are sent to the provider that runs it. At the
          date of this policy those providers are OpenAI (writing, the agent and
          image generation), fal.ai (image generation), Kie.ai (video
          generation), ElevenLabs (voice), HeyGen (avatar video, only if you add
          your own HeyGen key) and Tavily (web search for the agent), all in the
          United States or reached through servers there. [OWNER: CONFIRM WHICH
          OF THESE ARE SWITCHED ON IN PRODUCTION AND DELETE THE REST.] The rest
          of Apex is described in the{' '}
          <Ext href="https://voholabs.com/privacy">Voholabs Privacy Policy</Ext>
          . We do not use your content or your platform data to train AI models,
          and we do not send data obtained from Google, YouTube, Meta, TikTok,
          LinkedIn or X to an AI provider except where you ask an AI feature to
          work on it.
        </p>
      </LegalSection>

      <LegalSection
        id="purposes"
        title="8. Why we use your data and our lawful basis"
      >
        <LegalList
          items={[
            <>
              <strong>To provide the service:</strong> publishing your scheduled
              posts, rendering your calendar, and reporting analytics. Lawful
              basis: this is necessary to perform our contract with you.
            </>,
            <>
              <strong>To operate and secure the platform:</strong>{' '}
              authentication, checking that sign-ups are genuine, abuse
              prevention, backups, and diagnosing errors. Lawful basis: our
              legitimate interest in running a reliable and secure service.
            </>,
            <>
              <strong>
                To understand who uses Studio and to offer you Voholabs
                services.
              </strong>{' '}
              Studio is free because it introduces businesses to Voholabs. We
              use your name, work email, company website, role, stated use case
              and how you found us to understand our audience, to decide whether
              our paid services (such as Apex or our workshops) might be
              relevant to your business, and to contact you about them. We may
              look at your public company website to do this. [WHEN LIVE: We
              keep these details in our customer relationship system, HubSpot.]
              Lawful basis: our legitimate interest in growing our business by
              contacting business users who have chosen to use our product. You
              can object at any time, and we will stop: use the unsubscribe link
              in any email or write to hello@voholabs.com. Objecting does not
              affect your free account. We never use data from your connected
              social platforms for this.
            </>,
            <>
              <strong>Marketing email.</strong> Every marketing email we send
              says who it is from and has an unsubscribe link. If your address
              belongs to a company or other corporate body, we rely on the
              legitimate interest described above, and you can opt out at any
              time. If you signed up with a personal email address, or you are a
              sole trader or an ordinary partnership, we send marketing email
              only where you have agreed to it, and you can withdraw that
              agreement at any time. [OWNER AND SOLICITOR: THIS SENTENCE NEEDS
              AN OPT-IN OR OPT-OUT CONTROL ON THE ONBOARDING FORM TO BE TRUE.]
            </>,
            <>
              <strong>To send service and account messages:</strong> account
              activation, password resets, publishing failures and changes to
              these terms. Lawful basis: performance of our contract. You can
              turn post notifications off in settings.
            </>,
            <>
              <strong>To take payment for Apex</strong> and keep tax records.
              Lawful basis: performance of our contract and our legal
              obligations.
            </>,
          ]}
        />
        <p>
          We do not make decisions about you that have legal or similarly
          significant effects using automated processing alone.
        </p>
      </LegalSection>

      <LegalSection id="recipients" title="9. Who we share data with">
        <p>We do not sell personal data. We share it only as follows:</p>
        <LegalList
          items={[
            <>
              <strong>The social media platforms you connect</strong>, in order
              to publish your content and retrieve its analytics.
            </>,
            <>
              <strong>Railway</strong> (United States): application hosting and
              our database. [OWNER: CONFIRM HOSTING REGION.]
            </>,
            <>
              <strong>Cloudflare</strong> (United States, global network):
              network delivery and protection for the site, and storage of the
              media you upload (Cloudflare R2).
            </>,
            <>
              <strong>Resend</strong> (United States): delivery of account and
              notification email.
            </>,
            <>
              <strong>Google</strong> (United States): only if you choose to
              sign in with Google.
            </>,
            <>
              <strong>AI providers</strong> (United States): only for Apex
              customers who use an AI feature, as listed in section 7.
            </>,
            <>
              <strong>Stripe</strong>: payment for Apex, taken on voholabs.com.
            </>,
            <>
              [WHEN LIVE: <strong>HubSpot</strong> (United States, [EU DATA
              CENTRE IF SELECTED]): our customer relationship system, which
              holds the account and onboarding details described in section 8.
              It never receives data from your connected platforms.]
            </>,
            <>
              <strong>Tools you connect yourself</strong> through an API key,
              webhook or AI assistant, as described in section 7.
            </>,
            <>
              Professional advisers, a buyer of our business (under
              confidentiality), or authorities where we are legally required to
              disclose.
            </>,
          ]}
        />
        <p>
          The providers above process data on our instructions under written
          contracts. Voholabs Studio itself runs no advertising pixels and no
          third-party analytics trackers at the date of this policy. Our
          marketing site, voholabs.com, has its own{' '}
          <Ext href="https://voholabs.com/privacy">privacy policy</Ext>. If you
          reach Studio from a link on voholabs.com, that site records the click
          and its campaign tag in its own analytics tool, and passes the
          campaign tag to Studio in the link. We will update this list before we
          add or replace a provider.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="10. How long we keep data">
        <LegalList
          items={[
            <>
              Account data, onboarding answers and content: for as long as your
              account is open. We may close accounts that have not been used for
              12 months, after emailing a warning.
            </>,
            <>
              Connected channel tokens and cached platform data: until you
              remove the channel or your account is closed, then erased within
              30 days.
            </>,
            <>
              Media files: until you delete them or your account is closed.
              Deleting a file removes it from your library straight away. The
              stored copy is erased within 30 days.
            </>,
            <>
              Details we hold for sales contact: until you object or
              unsubscribe, or [24 MONTHS] after our last contact with you,
              whichever comes first. If you unsubscribe we keep your email
              address on a suppression list so that we do not contact you again.
            </>,
            <>Billing records: six years, as required by UK tax law.</>,
            <>Technical and error logs: up to 90 days. [OWNER: CONFIRM.]</>,
          ]}
        />
      </LegalSection>

      <LegalSection id="data-deletion" title="11. Deleting your data">
        <p>
          You can have the data Voholabs Studio holds about you deleted at any
          time. There is currently no button in the app that deletes a whole
          account, so account deletion is done by email. The options are:
        </p>
        <LegalList
          items={[
            <>
              <strong>Remove a single channel yourself.</strong> Open the
              launches screen, click the preferences menu on the channel you
              want to remove, and choose <em>Delete Channel</em>. We stop using
              that channel&apos;s access and refresh tokens at once, and erase
              them, together with the cached profile and analytics data we
              obtained from the channel, within 30 days. If the channel still
              has posts attached, delete those posts from the calendar first.
            </>,
            <>
              <strong>Delete your whole account.</strong> Email{' '}
              <a
                className="underline"
                href="mailto:hello@voholabs.com?subject=Delete%20my%20account"
              >
                hello@voholabs.com
              </a>{' '}
              from the address registered on your account with the subject{' '}
              <em>Delete my account</em>. We verify the request, reply within
              [5] working days, and permanently remove your account, your
              onboarding answers, your posts and media, every connected channel
              and all associated platform data within 30 days of verifying. You
              can use the same address to ask us to delete a specific part of
              your data, or to stop contacting you. If you are the only owner of
              an organisation with other team members, deleting your account
              deletes the organisation too.
            </>,
            <>
              <strong>Revoke access at the platform.</strong> You can
              independently revoke our access from the platform itself: Meta via{' '}
              <Ext href="https://www.facebook.com/settings?tab=business_tools">
                Facebook Settings, Business Integrations
              </Ext>
              , Google and YouTube via the{' '}
              <Ext href="https://security.google.com/settings/security/permissions">
                Google security settings page
              </Ext>
              , and TikTok under Settings and privacy in the TikTok app.
              Revoking at the platform stops our access but does not by itself
              erase what we already hold, so also remove the channel or email
              us.
            </>,
          ]}
        />
        <p>
          Backups are overwritten within [30] days of deletion, after which the
          data cannot be restored. We keep only what the law requires us to
          keep, such as billing records for six years under UK tax law, and a
          record of your deletion or unsubscribe request. Content you already
          published to a social platform stays on that platform; deleting it
          there is done from the platform itself.
        </p>
      </LegalSection>

      <LegalSection id="cookies" title="12. Cookies and browser storage">
        <p>Voholabs Studio stores information on your device as follows:</p>
        <LegalList
          items={[
            <>
              <strong>Sign-in cookie</strong> (strictly necessary): keeps you
              signed in. It is set on voholabs.com so that studio.voholabs.com
              and voholabs.com can both recognise your session.
            </>,
            <>
              <strong>Preference storage</strong> (strictly necessary): your
              language, selected organisation and interface settings.
            </>,
            <>
              <strong>How you found us</strong>: the first page you opened, the
              referring site and any campaign tag, kept in your browser&apos;s
              local storage until you complete onboarding (see section 2).
              [OWNER AND SOLICITOR: THIS IS NOT STRICTLY NECESSARY STORAGE. SEE
              THE PULL REQUEST NOTES ON PECR REGULATION 6.]
            </>,
          ]}
        />
        <p>
          Studio sets no advertising cookies and loads no third-party analytics
          scripts at the date of this policy. If that changes we will ask for
          your consent first where the law requires it, and update this page.
        </p>
      </LegalSection>

      <LegalSection id="security" title="13. Security">
        <p>
          Traffic to and from the service is encrypted in transit with TLS.
          Passwords are stored hashed, never in plain text. Our database and
          file storage sit with the hosting providers named in section 9.
          [OWNER: CONFIRM WHETHER CHANNEL TOKENS ARE ENCRYPTED AT REST. THE
          APPLICATION STORES THEM UNENCRYPTED, SO THIS IS TRUE ONLY IF THE
          HOSTING PROVIDER ENCRYPTS THE DATABASE VOLUME. IF CONFIRMED, ADD:
          &quot;Stored data, including channel tokens, is encrypted at rest by
          our hosting providers.&quot;] Access to production systems is
          restricted to the people who need it. Media files are stored at
          unlisted web addresses so that social platforms can fetch them; anyone
          who has the exact address of a file can open it. [OWNER: CONFIRM.] No
          system is perfectly secure, but we take reasonable and appropriate
          technical and organisational measures to protect your data, and we
          will notify you and the relevant regulator of a qualifying breach
          without undue delay.
        </p>
      </LegalSection>

      <LegalSection id="transfers" title="14. International transfers">
        <p>
          We are based in the United Kingdom. Most of the providers in section 9
          are in the United States, so your data is transferred there. Where
          data leaves the UK or the EEA we rely on UK adequacy regulations
          (including the UK Extension to the EU-US Data Privacy Framework for
          providers certified under it), or on the International Data Transfer
          Agreement or the UK Addendum to the EU Standard Contractual Clauses.
          You can ask us for a copy of the safeguard that applies.
        </p>
      </LegalSection>

      <LegalSection id="rights" title="15. Your rights">
        <p>
          Subject to the conditions in applicable data protection law, you have
          the right to access, correct, delete, restrict, port and object to our
          processing of your personal data, and to withdraw consent where
          processing is based on consent. You have an absolute right to object
          to direct marketing: tell us and we will stop.
        </p>
        <p>
          You can exercise any of these rights, including deleting your account
          and all associated data, by emailing{' '}
          <a className="underline" href="mailto:hello@voholabs.com">
            hello@voholabs.com
          </a>
          . See{' '}
          <a className="underline" href="#data-deletion">
            section 11
          </a>{' '}
          for step-by-step deletion instructions. We respond to requests within
          one month. If you are unhappy with how we handled your data, please
          tell us first at the same address. You can also complain to the UK
          Information Commissioner&apos;s Office at{' '}
          <Ext href="https://ico.org.uk/make-a-complaint/">ico.org.uk</Ext>, or,
          if you live in the EEA, to the data protection authority where you
          live.
        </p>
        <p>
          <strong>United States residents.</strong> We do not sell personal
          information and do not share it for cross-context behavioural
          advertising. You can use the address above to ask for access to or
          deletion of your information.
        </p>
      </LegalSection>

      <LegalSection id="children" title="16. Children">
        <p>
          Voholabs Studio is a business tool and is not directed at children.
          You must be at least 18 years old, or the minimum age required by the
          platforms you connect, whichever is higher, to use the service.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="17. Changes to this policy">
        <p>
          We may update this policy from time to time. The date at the top of
          this page shows when it last changed, and we will notify account
          holders by email of any material change before it takes effect.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
