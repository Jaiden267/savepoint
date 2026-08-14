import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/common/page-header";
import { Heading, Text } from "@/components/common/typography";
import { clientEnv } from "@/lib/env";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "How Savepoint collects, uses, shares and protects your information.",
  alternates: { canonical: "/privacy" },
};

const EFFECTIVE_DATE = "14 August 2026";

const proseText = "text-muted-foreground text-sm leading-relaxed";
const proseList =
  "text-muted-foreground list-disc space-y-1.5 pl-5 text-sm leading-relaxed";

interface SectionProps {
  id: string;
  title: string;
  children: ReactNode;
}

function Section({ id, title, children }: SectionProps) {
  return (
    <section id={id} className="scroll-mt-20">
      <Heading level="h4" as="h2" className="mb-3">
        {title}
      </Heading>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  const contactEmail = clientEnv.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <PageHeader
        title="Privacy policy"
        description={`Effective date: ${EFFECTIVE_DATE}`}
      />

      <Text className={`${proseText} mb-10`}>
        This policy explains what information Savepoint collects when you use
        the service, why, who it&apos;s shared with, and the choices and rights
        you have. It describes Savepoint as it is actually built today — it
        isn&apos;t a claim of formal legal certification, and it will be updated
        as the product changes.
      </Text>

      <div className="space-y-10">
        <Section id="who-we-are" title="1. Who operates Savepoint">
          <Text className={proseText}>
            Savepoint (&ldquo;Savepoint&rdquo;, &ldquo;we&rdquo;,
            &ldquo;us&rdquo;) is a social tracking, reviewing and discovery app
            for video games. The formal operating entity and registered address
            for this service have not yet been finalised for public launch; that
            detail will be added here, and this page&apos;s effective date
            updated, before Savepoint is made publicly available.
          </Text>
          <Text className={proseText}>
            You can make a privacy request or ask a question about this policy
            using the contact details in{" "}
            <a
              href="#contact"
              className="text-primary underline-offset-4 hover:underline"
            >
              &ldquo;How to contact us&rdquo;
            </a>{" "}
            below.
          </Text>
        </Section>

        <Section id="information-we-collect" title="2. Information we collect">
          <Text className={proseText}>
            <strong className="text-foreground font-medium">
              Account information.
            </strong>{" "}
            When you sign up, our authentication provider (Supabase Auth) stores
            your email address and password on our behalf — Savepoint&apos;s own
            application database does not keep a separate copy of your email or
            password. Once your account is created, we store a profile record
            containing your username, an optional display name, an optional
            short bio, and an optional avatar image (uploaded to Supabase
            Storage; avatar images are served from a public URL, so treat your
            avatar as visible to anyone with the link, not private).
          </Text>
          <Text className={proseText}>
            <strong className="text-foreground font-medium">
              User-generated content.
            </strong>{" "}
            Anything you create while using Savepoint: game ratings and play
            statuses (wishlist, backlog, playing, completed, paused, dropped),
            diary entries, written reviews (including whether you marked a
            review as containing spoilers) and comments, likes on reviews, lists
            and the games on them, who you follow, and feedback you give on
            recommendations (marking a suggestion Helpful, Not interested, or
            Already played).
          </Text>
          <Text className={proseText}>
            <strong className="text-foreground font-medium">
              Authentication and session information.
            </strong>{" "}
            Signing in sets necessary session cookies (managed by Supabase Auth)
            so you stay signed in and so Savepoint can tell your requests apart
            from an unauthenticated visitor&apos;s. These cookies are required
            for the service to function and are not used for advertising or
            cross-site tracking.
          </Text>
          <Text className={proseText}>
            <strong className="text-foreground font-medium">
              Search queries and recommendation signals.
            </strong>{" "}
            Text you type into search is used to look up games (via our local
            game catalogue, and via IGDB when a title isn&apos;t cached yet).
            Your ratings, statuses, diary entries, reviews, likes and
            recommendation feedback are combined into a taste profile used to
            rank and explain personalized suggestions on the &ldquo;For
            You&rdquo; page — see{" "}
            <a
              href="#personalisation"
              className="text-primary underline-offset-4 hover:underline"
            >
              &ldquo;Personalisation and recommendations&rdquo;
            </a>{" "}
            below for how that works and what it does not do.
          </Text>
          <Text className={proseText}>
            <strong className="text-foreground font-medium">
              Technical and log information.
            </strong>{" "}
            Like most web services, requests to Savepoint necessarily carry
            information such as your IP address, browser/user-agent string, the
            page or endpoint requested, and a timestamp. Savepoint uses your IP
            address transiently, in server memory only, to apply rate limits
            that slow down spam and abuse (e.g. repeated sign-up or
            password-reset attempts) — it is not written to our application
            database. Depending on where Savepoint is hosted, the underlying
            hosting/network infrastructure may separately keep short-lived
            request logs of this kind for security and reliability purposes; the
            specific hosting provider and its log retention are not yet
            finalised (see{" "}
            <a
              href="#retention"
              className="text-primary underline-offset-4 hover:underline"
            >
              &ldquo;Data retention&rdquo;
            </a>
            ).
          </Text>
        </Section>

        <Section id="why-we-process" title="3. Why we process this information">
          <ul className={proseList}>
            <li>To create and secure your account, and keep you signed in.</li>
            <li>
              To provide the core features you use Savepoint for: tracking,
              rating, reviewing, diary entries, lists, following other users,
              and browsing what they&apos;ve shared publicly.
            </li>
            <li>
              To search for and display game information, and to generate and
              explain personalized recommendations.
            </li>
            <li>
              To detect and slow down abuse (spam sign-ups, credential stuffing,
              scraping) and keep the service reliable.
            </li>
            <li>
              To communicate with you about your account — for example, email
              confirmation and password-reset emails.
            </li>
          </ul>
        </Section>

        <Section id="lawful-bases" title="4. Lawful bases for processing">
          <Text className={proseText}>
            Written cautiously, as a general guide rather than a case-by-case
            legal assessment:
          </Text>
          <ul className={proseList}>
            <li>
              <strong className="text-foreground font-medium">
                Performance of a contract:
              </strong>{" "}
              processing needed to create your account and provide the features
              you sign up for (profile, ratings, reviews, diary, lists, follows,
              recommendations).
            </li>
            <li>
              <strong className="text-foreground font-medium">
                Legitimate interests:
              </strong>{" "}
              rate-limiting and abuse prevention, and improving the relevance of
              search and recommendations, balanced against your rights and
              interests.
            </li>
            <li>
              <strong className="text-foreground font-medium">Consent:</strong>{" "}
              Savepoint does not currently set any non-essential (e.g. analytics
              or advertising) cookies that would require consent. If that ever
              changes, this policy and the relevant consent mechanism will be
              updated first.
            </li>
          </ul>
        </Section>

        <Section id="service-providers" title="5. Service providers we use">
          <Text className={proseText}>
            We use a small number of third-party services to run Savepoint. We
            share only what each one genuinely needs to do its job — not a
            general copy of your account:
          </Text>
          <ul className={proseList}>
            <li>
              <strong className="text-foreground font-medium">Supabase</strong>{" "}
              — our database, authentication and file storage provider. Supabase
              hosts your account credentials, session management, and the entire
              application database described in this policy (profile, ratings,
              reviews, diary, lists, follows, avatar images), protected by
              row-level access rules.
            </li>
            <li>
              <strong className="text-foreground font-medium">Resend</strong> —
              used as the outbound email relay behind Supabase Auth&apos;s own
              email sending (SMTP), for account-related emails only: confirming
              your email address and resetting your password. Savepoint&apos;s
              application code does not call Resend directly or send it any data
              beyond what Supabase Auth itself needs to deliver that one email
              (your address and the email&apos;s content).
            </li>
            <li>
              <strong className="text-foreground font-medium">Pinecone</strong>{" "}
              — powers semantic game search and recommendations. Pinecone stores
              and searches game metadata (titles, genres, platforms and similar
              descriptive text) for the game catalogue. To return personalized
              results, Savepoint sends Pinecone a short, synthetic search string
              built from the tags/genres in your taste profile (for example, a
              list of genres you tend to rate highly) — never your email
              address, username, or raw review/diary text.
            </li>
            <li>
              <strong className="text-foreground font-medium">
                IGDB / Twitch
              </strong>{" "}
              — the source of game data (titles, cover art, genres, platforms,
              release dates). Savepoint sends IGDB the game search terms needed
              to look up or import a game. IGDB does not receive your account
              details, ratings, reviews, or any other personal profile data — it
              only ever sees game-lookup queries.
            </li>
          </ul>
          <Text className={proseText}>
            Savepoint&apos;s hosting/deployment platform has not been finalised
            as of this policy&apos;s effective date; once it is, this section
            will name it and describe its role.
          </Text>
        </Section>

        <Section
          id="international-transfers"
          title="6. International processing and transfers"
        >
          <Text className={proseText}>
            The providers listed above may process data on servers located
            outside the UK, including in the United States. Where that happens,
            we rely on the safeguards those providers make available for their
            services (such as their own standard contractual terms). We have not
            yet completed a documented, provider-by-provider review confirming
            the specific safeguard in place for each one — doing so, and
            recording the result here, is a required action before public
            launch.
          </Text>
        </Section>

        <Section id="retention" title="7. Data retention">
          <Text className={proseText}>
            Savepoint does not currently have a formally documented retention
            schedule (e.g. &ldquo;diary entries are deleted after N
            years&rdquo;) — defining and publishing one is a required action
            before public launch. In practice today:
          </Text>
          <ul className={proseList}>
            <li>
              Account and profile data, and the content you create (ratings,
              reviews, diary entries, lists, comments, likes, follows,
              recommendation feedback), are kept for as long as your account
              exists.
            </li>
            <li>
              Deleting a specific piece of content you created (e.g. a review or
              diary entry) removes it from the database via the relevant in-app
              action, where that action exists.
            </li>
            <li>
              Search-result and recommendation caches are held in server memory
              only, for a fixed short window (around a minute), and are never
              written to persistent storage.
            </li>
            <li>
              Rate-limiting counters (built from your IP address) are held in
              server memory only and expire automatically, typically within
              minutes to an hour.
            </li>
          </ul>
        </Section>

        <Section
          id="deletion-and-rights"
          title="8. Account deletion and your rights"
        >
          <Text className={proseText}>
            Savepoint does not yet have a self-service &ldquo;delete my
            account&rdquo; control in the app. Until it does, you can request
            deletion, or exercise any of the rights below, using the contact
            details in{" "}
            <a
              href="#contact"
              className="text-primary underline-offset-4 hover:underline"
            >
              &ldquo;How to contact us&rdquo;
            </a>
            . Building a self-service deletion flow is a tracked, but not yet
            completed, product improvement.
          </Text>
          <Text className={proseText}>
            Subject to applicable law, you have the right to: access the
            personal data we hold about you; correct inaccurate data (some
            fields, like your display name and bio, you can already edit
            yourself in Settings); request deletion; request that we restrict
            certain processing; object to processing based on legitimate
            interests; receive a copy of your data in a portable format, where
            that right applies; and withdraw consent at any time for any
            processing that relies on it (Savepoint does not currently run any
            consent-based processing — see{" "}
            <a
              href="#lawful-bases"
              className="text-primary underline-offset-4 hover:underline"
            >
              &ldquo;Lawful bases for processing&rdquo;
            </a>
            ). If you&apos;re in the UK, you also have the right to complain to
            the Information Commissioner&apos;s Office (ICO) at{" "}
            <a
              href="https://ico.org.uk"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              ico.org.uk
            </a>
            .
          </Text>
        </Section>

        <Section
          id="personalisation"
          title="9. Personalisation and recommendations"
        >
          <Text className={proseText}>
            The &ldquo;For You&rdquo; page ranks games using a mix of the game
            catalogue&apos;s search relevance and simple, weighted signals from
            your own activity (for example, genres you rate highly, or games you
            mark Helpful). Every recommendation comes with a short,
            plain-language reason grounded in one of those real signals —
            reasons are generated by fixed rules, never by an AI model guessing
            or inventing an explanation.
          </Text>
          <Text className={proseText}>
            This personalisation only affects what order games are shown to you
            inside Savepoint. It does not make, and is not used to make, any
            legal or similarly significant decision about you — it has no effect
            on your account status, access, pricing, or anything outside game
            recommendations.
          </Text>
        </Section>

        <Section id="childrens-privacy" title="10. Children's privacy">
          <Text className={proseText}>
            Savepoint is a general-audience product about tracking and
            discussing video games, not a service directed at young children. It
            is not intended for use by anyone under 13, and we do not knowingly
            collect personal data from children under 13. Savepoint does not
            currently perform dedicated age verification at sign-up; if we
            become aware that we&apos;ve collected data from a child under 13,
            we will delete it.
          </Text>
        </Section>

        <Section id="cookies" title="11. Cookies and similar technology">
          <Text className={proseText}>
            Savepoint only uses strictly necessary cookies — set by Supabase
            Auth to keep you signed in and to protect the authentication flow.
            We do not currently use analytics, advertising, or any other
            non-essential cookies or tracking scripts, so we don&apos;t show a
            cookie-consent banner. If that changes, this policy and an
            appropriate consent mechanism will be added first.
          </Text>
        </Section>

        <Section id="security" title="12. Security">
          <Text className={proseText}>
            Access to your data is enforced through Supabase&apos;s Row Level
            Security, so that database queries made on your behalf are scoped to
            your own account and to content you&apos;ve chosen to make visible
            to others. Secrets and administrative database access are kept out
            of code that runs in your browser. No method of storage or
            transmission is completely secure, and we can&apos;t guarantee
            absolute security — but we take reasonable, ordinary technical
            measures to protect your information.
          </Text>
        </Section>

        <Section id="changes" title="13. Changes to this policy">
          <Text className={proseText}>
            We may update this policy as Savepoint changes. When we do,
            we&apos;ll update the effective date at the top of this page. For
            changes that materially affect how we handle your information,
            we&apos;ll take reasonable steps to make that change noticeable (for
            example, a notice on this page) rather than relying on the date
            change alone.
          </Text>
        </Section>

        <Section id="contact" title="14. How to contact us">
          {contactEmail ? (
            <Text className={proseText}>
              For privacy requests or questions about this policy, email{" "}
              <a
                href={`mailto:${contactEmail}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {contactEmail}
              </a>
              .
            </Text>
          ) : (
            <Text className={proseText}>
              A monitored privacy contact address has not yet been published
              here. This is a required action before Savepoint is made publicly
              available.
            </Text>
          )}
        </Section>
      </div>
    </main>
  );
}
