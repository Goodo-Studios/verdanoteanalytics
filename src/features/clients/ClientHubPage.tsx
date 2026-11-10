// Client hub: /clients/:slug with tabs Overview, Work, Briefs, Performance, Brand doc, Meetings and
// Scope. The client is in the address, so no tab asks for it again: the existing pages inside the
// tabs read the one shared selection, which the address sets. Scope holds engagements, deliverables,
// QA gates, handoffs, scope changes, strategy and recommendations as sub-tabs.
//
// Staff only (the route guard in App.tsx). Old addresses of the pages that moved in here redirect to
// the matching tab, so bookmarks and the ?client= links keep working.
import { Suspense } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { EmptyState, PageShell } from "@/components/page-kit";
import { PageSkeleton } from "@/components/skeletons/PageSkeleton";
import { pageFor, prefetchPage } from "@/components/sections/lazyPages";
import { useAuth } from "@/contexts/AuthContext";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { useAccountReady } from "@/hooks/useAccountReady";
import { useRolePrefix } from "@/hooks/useRolePath";
import { HUB_TABS, SCOPE_SUBTABS, hubPath } from "@/lib/clientHub";

const TAB_LINK = "whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors";
const TAB_ON = "border-verdant font-semibold text-forest";
const TAB_OFF = "border-transparent text-slate hover:text-forest";

export default function ClientHubPage() {
  const { slug = "", tab, sub } = useParams<{ slug: string; tab?: string; sub?: string }>();
  const prefix = useRolePrefix();
  const { clients, isLoading, selectedClient, noAccount } = useClientSelection();
  const accountReady = useAccountReady();
  const { isBuilder } = useAuth();

  const known = clients.length === 0 || clients.some((c) => c.slug === slug);
  if (!isLoading && !known) {
    return (
      <PageShell data-testid="client-hub-not-found">
        <EmptyState
          title="We couldn&rsquo;t find this client"
          description="It may have been removed, or the link may be out of date."
          action={<Link to={`${prefix}/clients`} className="underline text-sm">Go to Clients</Link>}
        />
      </PageShell>
    );
  }

  const active = HUB_TABS.find((t) => t.slug === (tab ?? "overview"));
  if (!active) return <Navigate to={`${prefix}${hubPath(slug)}`} replace />;
  const activeSub = active.slug === "scope" ? SCOPE_SUBTABS.find((s) => s.slug === (sub ?? SCOPE_SUBTABS[0].slug)) : undefined;
  if (active.slug === "scope" && !activeSub) return <Navigate to={`${prefix}${hubPath(slug, "scope")}`} replace />;
  if (active.slug !== "scope" && sub) return <Navigate to={`${prefix}${hubPath(slug, active.slug)}`} replace />;

  const name = selectedClient?.name ?? slug;
  const Page = pageFor(activeSub ? activeSub.page : active.page);

  return (
    <div data-testid="client-hub">
      <div className="border-b border-border/60 px-4 pt-3 md:px-6">
        <p className="text-xs text-muted-foreground">
          <Link to={`${prefix}/clients`} className="underline">Clients</Link> / <span data-testid="client-hub-name">{name}</span>
        </p>
        <nav aria-label="Client tabs" className="-mb-px mt-1 flex gap-1 overflow-x-auto">
          {HUB_TABS.filter((t) => !t.builderOnly || isBuilder).map((t) => (
            <Link
              key={t.slug}
              to={`${prefix}${hubPath(slug, t.slug)}`}
              aria-current={t.slug === active.slug ? "page" : undefined}
              onMouseEnter={() => prefetchPage(t.page)}
              className={`${TAB_LINK} ${t.slug === active.slug ? TAB_ON : TAB_OFF}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {activeSub ? (
          <nav aria-label="Scope sections" className="mt-1 flex gap-1 overflow-x-auto">
            {SCOPE_SUBTABS.map((s) => (
              <Link
                key={s.slug}
                to={`${prefix}${hubPath(slug, "scope", s.slug)}`}
                aria-current={s.slug === activeSub.slug ? "page" : undefined}
                onMouseEnter={() => prefetchPage(s.page)}
                className={`${TAB_LINK} text-[13px] ${s.slug === activeSub.slug ? TAB_ON : TAB_OFF}`}
              >
                {s.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
      <Suspense fallback={<PageSkeleton />}>
        {active.needsAccount && noAccount ? (
          <PageShell data-testid="no-ad-account">
            <EmptyState
              title={`${name} has no ad account linked yet.`}
              description={`${active.label} reads a client’s ad account, so there is nothing to show here.`}
            />
          </PageShell>
        ) : active.needsAccount && !accountReady ? (
          <PageSkeleton />
        ) : (
          <Page />
        )}
      </Suspense>
    </div>
  );
}
