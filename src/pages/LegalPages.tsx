import { useEffect } from "react";

/**
 * Public legal pages (no auth): Privacy Policy, Terms of Service, and Data
 * Deletion Instructions. These are linked from the Meta App dashboard
 * (Privacy Policy URL / Terms of Service URL / User data deletion URL) and must
 * be publicly reachable, so they live in the unauthenticated route block.
 */

const ORG = "Matthew Gattozzi LLC (dba Goodo Studios)";
const ADDRESS = "2940 Westlake Ave N, Suite 302, Seattle, WA 98119, USA";
const CONTACT = "matthew@goodostudios.com";
const UPDATED = "July 16, 2026";

function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  useEffect(() => {
    document.title = `${title} — Verdanote`;
  }, [title]);
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <a href="/" className="font-heading text-[20px] text-forest">
            Verdanote
          </a>
          <a
            href="/"
            className="font-body text-[13px] font-medium text-verdant hover:underline"
          >
            Home
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="mb-2 font-heading text-[34px] text-forest">{title}</h1>
        <p className="mb-10 font-body text-[13px] text-slate">Last updated: {UPDATED}</p>
        <article className="space-y-6 font-body text-[15px] leading-relaxed text-foreground [&_h2]:font-heading [&_h2]:text-[20px] [&_h2]:text-forest [&_h2]:pt-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_a]:text-verdant [&_a]:underline">
          {children}
        </article>
        <footer className="mt-14 border-t border-border pt-6 font-body text-[13px] text-slate">
          <p>{ORG}</p>
          <p>{ADDRESS}</p>
          <p>
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
          </p>
        </footer>
      </main>
    </div>
  );
}

export function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>
        Verdanote is a product of {ORG} ("we", "us", "our"). This Privacy Policy
        explains what data Verdanote handles and how we handle it.
      </p>

      <h2>What Verdanote does</h2>
      <p>
        Verdanote is an analytics and creative-archival tool for advertising
        teams. It connects to Meta (Facebook and Instagram) advertising accounts
        that you own or that a client has granted you access to, reads advertising
        performance data and ad creative (images and videos), and presents reports
        and a searchable creative library to authorized team members.
      </p>

      <h2>Data we process</h2>
      <ul>
        <li>
          Meta advertising data: campaign, ad set, and ad-level performance
          metrics, ad metadata, and ad creative assets (images, videos,
          thumbnails), retrieved through the Meta Marketing and Graph APIs using
          access you have authorized.
        </li>
        <li>Business and ad-account identifiers used to organize that data.</li>
        <li>
          Basic account information for Verdanote users you invite, such as name
          and email address.
        </li>
      </ul>
      <p>
        We do not sell personal data. We do not use Meta data for any purpose
        other than providing the analytics and creative-archival features to you
        and to the client who owns the relevant ad account.
      </p>

      <h2>How we store it</h2>
      <p>
        Advertising data and cached creative media are stored in our hosted
        database and object storage (Supabase, on infrastructure located in the
        United States). Access is restricted to authorized users of the relevant
        business or ad account.
      </p>

      <h2>Sharing</h2>
      <p>
        We share data only with the infrastructure providers that operate the
        service (for example, Supabase) and only as needed to run Verdanote. We do
        not share Meta data with third parties for advertising or resale.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        We retain advertising data and cached media for as long as your account is
        active or as needed to provide the service. You may request deletion at any
        time — see our{" "}
        <a href="/data-deletion">Data Deletion Instructions</a>. When an ad account
        is disconnected from Verdanote, we stop retrieving new data for it.
      </p>

      <h2>Your choices</h2>
      <p>
        You can disconnect a Meta ad account at any time from Meta Business
        Settings, which revokes Verdanote's access. You can request export or
        deletion of your data by contacting us at {CONTACT}.
      </p>

      <h2>Contact</h2>
      <p>
        {ORG}
        <br />
        {ADDRESS}
        <br />
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service">
      <p>These terms govern use of Verdanote, a product of {ORG}.</p>

      <h2>1. Service</h2>
      <p>
        Verdanote provides advertising analytics and creative archival by
        connecting to Meta advertising accounts you own or are authorized to
        access.
      </p>

      <h2>2. Authorized use</h2>
      <p>
        You may connect only advertising accounts you own or have explicit
        permission to access. You are responsible for having that authorization.
      </p>

      <h2>3. Acceptable use</h2>
      <p>
        You will not use Verdanote to violate Meta's Platform Terms, Meta's
        Developer Policies, or applicable law.
      </p>

      <h2>4. Data</h2>
      <p>
        Your use of data retrieved through Verdanote is also governed by Meta's
        terms and by our <a href="/privacy-policy">Privacy Policy</a>.
      </p>

      <h2>5. Availability</h2>
      <p>
        The service is provided "as is" without warranties. We may modify or
        discontinue features at any time.
      </p>

      <h2>6. Limitation of liability</h2>
      <p>
        To the extent permitted by law, {ORG} is not liable for indirect or
        consequential damages arising from use of the service.
      </p>

      <h2>7. Termination</h2>
      <p>
        We may suspend access for violations of these terms. You may stop using
        the service and request deletion of your data at any time.
      </p>

      <h2>8. Contact</h2>
      <p>
        {ORG}
        <br />
        {ADDRESS}
        <br />
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
    </LegalLayout>
  );
}

export function DataDeletionPage() {
  return (
    <LegalLayout title="Data Deletion Instructions">
      <p>
        To request deletion of data associated with your Verdanote account or a
        connected Meta advertising account, follow these steps:
      </p>
      <ul>
        <li>
          Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from the address
          associated with your account, with the subject "Data Deletion Request",
          and include the ad account name or ID you want removed.
        </li>
        <li>
          We will delete the associated advertising data and cached creative media
          from our systems within 30 days and confirm by email.
        </li>
        <li>
          You may also immediately revoke Verdanote's access to any advertising
          account from Meta Business Settings → Business assets, which stops all
          further data retrieval.
        </li>
      </ul>

      <h2>Contact</h2>
      <p>
        {ORG}
        <br />
        {ADDRESS}
        <br />
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
    </LegalLayout>
  );
}
