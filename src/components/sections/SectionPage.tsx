// One page per menu section (Production, Talent, Creative, Knowledge, Admin). A tab bar on
// top and the existing page for the open tab below it, rendered unchanged. Staff only: a
// client, or a builder previewing the client view, goes to the index. A builder-only tab goes
// to the index for anyone else, the same as its old route did.
import { Suspense } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { RequireOneAccount } from "@/components/RequireOneAccount";
import { PageSkeleton } from "@/components/skeletons/PageSkeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { useRolePrefix } from "@/hooks/useRolePath";
import { pageFor, prefetchPage } from "@/components/sections/lazyPages";
import { useAccountReady } from "@/hooks/useAccountReady";
import { isHiddenPage } from "@/lib/hiddenPages";
import { groupsFor, sectionPath, tabsFor, type SectionDef, type TabDef } from "@/lib/sections";

function NoAccountNotice({ tab }: { tab: TabDef }) {
  const { selectedClient, selectedSlug } = useClientSelection();
  const prefix = useRolePrefix();
  const name = selectedClient?.name ?? selectedSlug;
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm space-y-2" data-testid="no-ad-account">
      <p className="font-medium">{name} has no ad account linked yet.</p>
      <p className="text-muted-foreground">{tab.label} reads a client&rsquo;s ad account, so there is nothing to show here.</p>
      <Link to={`${prefix}/clients/${encodeURIComponent(selectedSlug)}`} className="underline">
        Open {name}
      </Link>
    </div>
  );
}

export function SectionPage({ section }: { section: SectionDef }) {
  const { tab: tabSlug } = useParams<{ tab?: string }>();
  const prefix = useRolePrefix();
  const { isClient, isBuilder, isEmployee } = useAuth();
  const { isClientPreview, isEmployeePreview } = useClientPreview();
  const { noAccount } = useClientSelection();
  const accountReady = useAccountReady();

  const effectiveClient = isClient || isClientPreview;
  const staffPage = (isBuilder || isEmployee) && !effectiveClient;
  const effectiveBuilder = isBuilder && !isClientPreview && !isEmployeePreview;
  const home = <Navigate to={`${prefix}/`} replace />;
  if (!staffPage) return home;

  const tabs = tabsFor(section, effectiveBuilder);
  if (!tabSlug) {
    return <Navigate to={`${prefix}${sectionPath(section, tabs[0])}`} replace />;
  }
  const tab = section.tabs.find((t) => t.slug === tabSlug);
  if (!tab) return <Navigate to={`${prefix}${sectionPath(section, tabs[0])}`} replace />;
  if ((tab.builderOnly || isHiddenPage(tab.page)) && !effectiveBuilder) return home;

  const Page = pageFor(tab.page);
  const body = tab.requireOneAccount ? (
    <RequireOneAccount pageName={tab.requireOneAccount}>
      <Page />
    </RequireOneAccount>
  ) : (
    <Page />
  );

  const tabLink = (t: TabDef) => {
    const active = t.slug === tab.slug;
    return (
      <Link
        key={t.slug}
        to={`${prefix}${sectionPath(section, t)}`}
        aria-current={active ? "page" : undefined}
        onMouseEnter={() => prefetchPage(t.page)}
        className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
          active ? "border-verdant font-semibold text-forest" : "border-transparent text-slate hover:text-forest"
        }`}
      >
        {t.label}
      </Link>
    );
  };

  // Grouped section (Creative): a row of groups, then only the open group's tabs.
  const groups = groupsFor(section, effectiveBuilder);
  if (groups.length > 0) {
    const openGroup = tab.group ?? groups[0];
    const groupTabs = tabs.filter((t) => t.group === openGroup);
    return (
      <div data-testid={`section-${section.id}`}>
        <div className="border-b border-border/60 px-4 pt-3 md:px-6">
          <p className="font-label text-[10px] uppercase tracking-[0.1em] text-sage">{section.label}</p>
          <nav aria-label={`${section.label} groups`} className="mt-1 flex flex-wrap gap-1">
            {groups.map((g) => {
              const first = tabs.find((t) => t.group === g)!;
              const active = g === openGroup;
              return (
                <Link
                  key={g}
                  to={`${prefix}${sectionPath(section, first)}`}
                  aria-current={active ? "true" : undefined}
                  onMouseEnter={() => prefetchPage(first.page)}
                  className={`whitespace-nowrap rounded-full px-3 py-1 text-sm transition-colors ${
                    active ? "bg-accent font-semibold text-forest" : "text-slate hover:text-forest"
                  }`}
                >
                  {g}
                </Link>
              );
            })}
          </nav>
          <nav aria-label={`${openGroup} tabs`} className="-mb-px mt-1 flex flex-wrap gap-1">
            {groupTabs.map(tabLink)}
          </nav>
        </div>
        <Suspense fallback={<PageSkeleton />}>
          {tab.needsAccount && noAccount ? (
            <div className="p-6"><NoAccountNotice tab={tab} /></div>
          ) : tab.needsAccount && !accountReady ? (
            <PageSkeleton />
          ) : (
            body
          )}
        </Suspense>
      </div>
    );
  }

  let lastGroup: string | undefined;
  return (
    <div data-testid={`section-${section.id}`}>
      <div className="border-b border-border/60 px-4 pt-3 md:px-6">
        <p className="font-label text-[10px] uppercase tracking-[0.1em] text-sage">{section.label}</p>
        <nav aria-label={`${section.label} tabs`} className="-mb-px mt-1 flex gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const showGroup = t.group && t.group !== lastGroup;
            lastGroup = t.group;
            const active = t.slug === tab.slug;
            return (
              <div key={t.slug} className="flex items-center gap-1">
                {showGroup ? (
                  <span className="ml-3 mr-1 whitespace-nowrap font-label text-[10px] uppercase tracking-[0.1em] text-sage">{t.group}</span>
                ) : null}
                <Link
                  to={`${prefix}${sectionPath(section, t)}`}
                  aria-current={active ? "page" : undefined}
                  onMouseEnter={() => prefetchPage(t.page)}
                  className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                    active ? "border-verdant font-semibold text-forest" : "border-transparent text-slate hover:text-forest"
                  }`}
                >
                  {t.label}
                </Link>
              </div>
            );
          })}
        </nav>
      </div>
      <Suspense fallback={<PageSkeleton />}>
        {tab.needsAccount && noAccount ? (
          <div className="p-6"><NoAccountNotice tab={tab} /></div>
        ) : tab.needsAccount && !accountReady ? (
          <PageSkeleton />
        ) : (
          body
        )}
      </Suspense>
    </div>
  );
}
