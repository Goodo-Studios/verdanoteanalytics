// Briefs (OS-019): tasks still in the brief stage that have a brief, oldest due first. Read only.
// Replaces the ClickUp client brief view.
import { memo, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-kit";
import { useClientCards } from "@/hooks/useClientCards";
import { briefCards, type ClientCard } from "@/lib/clientPages";
import { todayIso } from "@/lib/homeData";
import { ClientCardShell, DueLabel, PageIntro } from "./ClientCardBits";

const BriefCard = memo(function BriefCard({ card, today, open }: { card: ClientCard; today: string; open: boolean }) {
  return (
    <ClientCardShell testId="client-brief-card">
      <details open={open}>
        <summary className="flex cursor-pointer list-none items-center gap-3">
          <span className="min-w-0 flex-1 truncate font-medium" data-testid="client-card-title">{card.title}</span>
          <DueLabel due={card.due_date} today={today} />
        </summary>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground" data-testid="client-brief-text">{card.brief}</p>
      </details>
    </ClientCardShell>
  );
});

export default function ClientBriefsPage() {
  const cards = useClientCards();
  const [params] = useSearchParams();
  const focus = params.get("task");
  const today = todayIso();
  const briefs = useMemo(() => briefCards(cards.data ?? []), [cards.data]);

  return (
    <div className="max-w-3xl space-y-4" data-testid="client-briefs-page">
      <PageIntro title="Briefs" description="Briefs we are preparing for you, soonest first." />
      {cards.isLoading ? (
        <LoadingState />
      ) : cards.isError ? (
        <ErrorState title="We could not load your briefs." message="Please try again." onRetry={() => void cards.refetch()} />
      ) : briefs.length === 0 ? (
        <EmptyState title="No briefs right now" description="New briefs show here when they are ready for you to read." />
      ) : (
        <div className="space-y-3">
          {briefs.map((c, i) => (
            <BriefCard key={c.id} card={c} today={today} open={focus ? focus === c.id : i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}
