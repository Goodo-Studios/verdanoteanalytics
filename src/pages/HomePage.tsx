// Staff Home. The front door of the staff area: what to do today and the client you are
// working on. The sidebar is the way into each part of the app, so Home does not repeat it
// as cards (Goodo OS OS-002). Goodo Time and Attio stay in the sidebar footer. Clients never
// see this page; their index is the Overview.
import { Link } from "react-router-dom";
import { PageHeader, PageShell } from "@/components/page-kit";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { useRolePrefix } from "@/hooks/useRolePath";
import { HomeTabs } from "@/features/home/HomeTabs";
import { StaffHomeBlocks } from "@/features/home/StaffHomeBlocks";
import { TodayPanel } from "@/features/home/TodayPanel";

export default function HomePage() {
  const prefix = useRolePrefix();
  const { selectedClient, selectedSlug } = useClientSelection();

  return (
    <PageShell className="space-y-6" data-testid="home-page">
      <PageHeader title="Home" description="What to do today. Pick a client at the top of the page to work on one." className="mb-2" />
      <HomeTabs active="today" />

      <TodayPanel />

      <section aria-label="More for today" className="space-y-3 border-t border-border/60 pt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">More for today</h2>
        <StaffHomeBlocks />
      </section>

      <section aria-label="Current client" className="rounded-lg border border-input p-4">
        {selectedSlug ? (
          <p className="text-sm">
            You are working on <span className="font-semibold">{selectedClient?.name ?? selectedSlug}</span>.{" "}
            <Link to={`${prefix}/clients/${encodeURIComponent(selectedSlug)}`} className="underline" data-testid="home-open-client">
              Open this client
            </Link>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No client picked. The pages that work on one client ask you to pick one in the switcher at the top.
          </p>
        )}
      </section>
    </PageShell>
  );
}
