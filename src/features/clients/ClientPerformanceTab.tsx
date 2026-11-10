// Client hub, Performance tab: the way into the ad analytics for this client's ad account. The client
// is already selected (it is in the address), so each link opens the Creative page on this client's
// ad account. A client with several ad accounts uses the "Ad account" chooser at the top; a client
// with none is told so.
import { Link } from "react-router-dom";
import { PageHeader, PageShell } from "@/components/page-kit";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { useRolePrefix } from "@/hooks/useRolePath";

const LINKS = [
  { to: "/creative/overview", title: "Overview", text: "Spend, results and trends." },
  { to: "/creative/creatives", title: "Creatives", text: "Every ad with its numbers." },
  { to: "/creative/analytics", title: "Analytics", text: "Hooks, angles and what is working." },
  { to: "/creative/reports", title: "Reports", text: "Build and share reports." },
  { to: "/creative/landing-pages", title: "Landing Pages", text: "Spend and results by landing page." },
  { to: "/creative/rotation", title: "Creative Rotation", text: "Freshness and new ad cohorts." },
];

export default function ClientPerformanceTab() {
  const prefix = useRolePrefix();
  const { selectedClient, selectedSlug, linkedAccounts, noAccount } = useClientSelection();
  const name = selectedClient?.name ?? selectedSlug;

  return (
    <PageShell data-testid="client-performance">
      <PageHeader title="Performance" description={`Ad performance for ${name}.`} />
      {noAccount ? (
        <p className="rounded-lg border border-dashed p-6 text-sm" data-testid="client-performance-no-account">
          {name} has no ad account linked yet, so there is no performance to show. Ask a builder to link one.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="client-performance-accounts">
            {linkedAccounts.length === 0
              ? "Looking up this client's ad account..."
              : linkedAccounts.length === 1
                ? `Ad account: ${linkedAccounts[0].name}.`
                : `${linkedAccounts.length} ad accounts: ${linkedAccounts.map((a) => a.name).join(", ")}. The Ad account chooser at the top of the page picks which one the pages below show.`}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {LINKS.map((l) => (
              <li key={l.to}>
                <Link to={`${prefix}${l.to}`} className="block rounded-lg border border-input bg-background px-4 py-3 hover:bg-accent" data-testid={`performance-link-${l.to.split("/").pop()}`}>
                  <span className="text-[14px] font-semibold text-forest">{l.title}</span>
                  <p className="mt-1 text-[12px] text-muted-foreground">{l.text}</p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </PageShell>
  );
}
