// Assets (OS-019): approved and delivered work (Ready to Launch) with an asset link, grouped by the
// month of the due date, newest month first. Each download link opens the asset URL. Replaces the
// ClickUp client asset view.
import { memo, useMemo } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-kit";
import { useClientCards } from "@/hooks/useClientCards";
import { groupAssetsByMonth, type AssetMonth } from "@/lib/clientPages";
import { shortDate } from "@/lib/homeData";
import { AssetLink, PageIntro } from "./ClientCardBits";

const MonthGroup = memo(function MonthGroup({ month }: { month: AssetMonth }) {
  return (
    <section data-testid="client-asset-month" aria-label={month.label}>
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-widest text-sage" data-testid="client-asset-month-label">
        {month.label}
      </h2>
      <ul className="divide-y divide-[var(--gos-line,#e9e5de)] rounded-[var(--gos-radius-card,20px)] border border-[var(--gos-line,#e9e5de)] bg-card">
        {month.cards.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-5 py-3" data-testid="client-asset-row">
            <span className="min-w-0 flex-1 truncate text-sm font-medium" data-testid="client-card-title">{c.title}</span>
            <span className="text-xs text-muted-foreground">{c.due_date ? shortDate(c.due_date) : ""}</span>
            {c.asset_url ? <AssetLink href={c.asset_url}>Download</AssetLink> : null}
          </li>
        ))}
      </ul>
    </section>
  );
});

export default function ClientAssetsPage() {
  const cards = useClientCards();
  const months = useMemo(() => groupAssetsByMonth(cards.data ?? []), [cards.data]);

  return (
    <div className="max-w-3xl space-y-6" data-testid="client-assets-page">
      <PageIntro title="Assets" description="Your approved and delivered work, by month." />
      {cards.isLoading ? (
        <LoadingState />
      ) : cards.isError ? (
        <ErrorState title="We could not load your assets." message="Please try again." onRetry={() => void cards.refetch()} />
      ) : months.length === 0 ? (
        <EmptyState title="No assets yet" description="Approved work shows here with a download link." />
      ) : (
        months.map((m) => <MonthGroup key={m.key} month={m} />)
      )}
    </div>
  );
}
