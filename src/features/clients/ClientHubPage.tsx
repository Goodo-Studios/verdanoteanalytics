// Client hub: /clients/:slug with tabs Overview, Work, Briefs, Performance, Brand doc, Meetings and
// Scope. The client is in the address, so no tab asks for it again: the existing pages inside the
// tabs read the one shared selection, which the address sets. Scope holds engagements, deliverables,
// QA gates, handoffs, scope changes, strategy and recommendations as sub-tabs.
//
// Staff only (the route guard in App.tsx). Old addresses of the pages that moved in here redirect to
// the matching tab, so bookmarks and the ?client= links keep working.
import { lazy, Suspense } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { EmptyState, PageShell } from "@/components/page-kit";
import { PageSkeleton } from "@/components/skeletons/PageSkeleton";
import { pageFor, prefetchPage } from "@/components/sections/lazyPages";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { useAccountReady } from "@/hooks/useAccountReady";
import { useRolePrefix } from "@/hooks/useRolePath";
import { HUB_CUSTOM_TABS, HUB_TABS, SCOPE_SUBTABS, hubPath } from "@/lib/clientHub";
import { isHiddenPage } from "@/lib/hiddenPages";
import { useRealBuilder } from "@/hooks/useRealBuilder";
import { ClientMonthDelivery } from "./ClientMonthDelivery";

// The taxonomy editor is heavy and builder only, so it loads when its tab opens.
const ClientTaxonomyTab = lazy(() => import("./ClientTaxonomyTab"));

const TAB_LINK = "whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors";
const TAB_ON = "border-verdant font-semibold text-forest";
const TAB_OFF = "border-transparent text-slate hover:text-forest";

export default function ClientHubPage() {
  const { slug = "", tab, sub } = useParams<{ slug: string; tab?: string; sub?: string }>();
  const prefix = useRolePrefix();
  const { clients, isLoading, selectedClient, noAccount } = useClientSelection();
  const accountReady = useAccountReady();
  const realBuilder = useRealBuilder();

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

  const customTab = HUB_CUSTOM_TABS.find((t) => t.slug === tab);
  const active = customTab ? undefined : HUB_TABS.find((t) => t.slug === (tab ?? "overview"));
  if (!active && !customTab) return <Navigate to={`${prefix}${hubPath(slug)}`} replace />;
  if (customTab && sub) return <Navigate to={`${prefix}${hubPath(slug, customTab.slug)}`} replace />;
  const activeSlug = customTab ? customTab.slug : active!.slug;
  // Hidden pages (src/lib/hiddenPages.ts) are not listed; the address opens for a builder only.
  const shownSubs = SCOPE_SUBTABS.filter((s) => !isHiddenPage(s.page));
  const activeSub = active?.slug === "scope" ? SCOPE_SUBTABS.find((s) => s.slug === (sub ?? shownSubs[0].slug)) : undefined;
  if (activeSub && isHiddenPage(activeSub.page) && !realBuilder) return <Navigate to={`${prefix}${hubPath(slug, "scope")}`} replace />;
  if (active?.slug === "scope" && !activeSub) return <Navigate to={`${prefix}${hubPath(slug, "scope")}`} replace />;
  if (active && active.slug !== "scope" && sub) return <Navigate to={`${prefix}${hubPath(slug, active.slug)}`} replace />;

  const name = selectedClient?.name ?? slug;
  const Page = active ? pageFor(activeSub ? activeSub.page : active.page) : null;
  const needsAccount = customTab ? customTab.needsAccount : active?.needsAccount;
  const activeLabel = customTab ? customTab.label : active!.label;

  return (
    <div data-testid="client-hub">
      <div className="border-b border-border/60 px-4 pt-3 md:px-6">
        <p className="text-xs text-muted-foreground">
          <Link to={`${prefix}/clients`} className="underline">Clients</Link> / <span data-testid="client-hub-name">{name}</span>
        </p>
        <ClientMonthDelivery slug={slug} />
        <nav aria-label="Client tabs" className="-mb-px mt-1 flex gap-1 overflow-x-auto">
          {HUB_TABS.filter((t) => !t.builderOnly || realBuilder).map((t) => (
            <Link
              key={t.slug}
              to={`${prefix}${hubPath(slug, t.slug)}`}
              aria-current={t.slug === activeSlug ? "page" : undefined}
              onMouseEnter={() => prefetchPage(t.page)}
              className={`${TAB_LINK} ${t.slug === activeSlug ? TAB_ON : TAB_OFF}`}
            >
              {t.label}
            </Link>
          ))}
          {HUB_CUSTOM_TABS.filter((t) => !t.builderOnly || realBuilder).map((t) => (
            <Link
              key={t.slug}
              to={`${prefix}${hubPath(slug, t.slug)}`}
              aria-current={t.slug === activeSlug ? "page" : undefined}
              className={`${TAB_LINK} ${t.slug === activeSlug ? TAB_ON : TAB_OFF}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {activeSub ? (
          <nav aria-label="Scope sections" className="mt-1 flex gap-1 overflow-x-auto">
            {shownSubs.map((s) => (
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
        {needsAccount && noAccount ? (
          <PageShell data-testid="no-ad-account">
            <EmptyState
              title={`${name} has no ad account linked yet.`}
              description={`${activeLabel} reads a client’s ad account, so there is nothing to show here.`}
            />
          </PageShell>
        ) : needsAccount && !accountReady ? (
          <PageSkeleton />
        ) : customTab ? (
          <ClientTaxonomyTab clientName={name} />
        ) : (
          Page && <Page />
        )}
      </Suspense>
    </div>
  );
}
