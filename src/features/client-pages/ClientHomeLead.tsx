// The top of a client's home (OS-019): the one item that needs the client, then a short list of
// what comes after it. Reads only the client cards (allow-listed fields).
import { Link } from "react-router-dom";
import { useMemo } from "react";
import { useClientCards } from "@/hooks/useClientCards";
import { useRolePrefix } from "@/hooks/useRolePath";
import { todayIso } from "@/lib/homeData";
import { nextItem, upNext, REVIEW_STAGE } from "@/lib/clientPages";
import { ClientCardShell, DueLabel } from "./ClientCardBits";

export function ClientHomeLead() {
  const prefix = useRolePrefix();
  const cards = useClientCards();
  const today = todayIso();
  const lead = useMemo(() => nextItem(cards.data ?? []), [cards.data]);
  const rest = useMemo(() => upNext(cards.data ?? [], lead), [cards.data, lead]);

  if (cards.isLoading) return null;
  if (cards.isError) {
    return (
      <p className="rounded-[8px] border border-input px-4 py-3 text-[13px] text-muted-foreground" data-testid="client-home-lead">
        We could not check what needs you right now.
      </p>
    );
  }

  return (
    <section className="space-y-4" data-testid="client-home-lead" aria-label="What needs you">
      {lead.kind === "none" ? (
        <ClientCardShell testId="client-next-none">
          <p className="text-[11px] font-medium uppercase tracking-widest text-sage">Next for you</p>
          <p className="mt-2 font-heading text-[22px] text-forest">Nothing needs you right now.</p>
          <p className="mt-1 text-sm text-muted-foreground">We will let you know when something is ready for your review.</p>
        </ClientCardShell>
      ) : (
        <ClientCardShell testId="client-next-item">
          <p className="text-[11px] font-medium uppercase tracking-widest text-sage">
            {lead.kind === "review" ? "Ready for your review" : "Brief to read"}
          </p>
          <p className="mt-2 font-heading text-[22px] text-forest" data-testid="client-next-title">{lead.card.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <DueLabel due={lead.card.due_date} today={today} />
            <Link
              to={lead.kind === "review" ? `${prefix}/review?task=${lead.card.id}` : `${prefix}/brief-review?task=${lead.card.id}`}
              className="text-sm font-medium text-verdant underline-offset-2 hover:underline"
            >
              {lead.kind === "review" ? "Review it" : "Read the brief"}
            </Link>
          </div>
        </ClientCardShell>
      )}
      {rest.length > 0 ? (
        <ul className="divide-y divide-[var(--gos-line,#e9e5de)] rounded-[var(--gos-radius-card,20px)] border border-[var(--gos-line,#e9e5de)] bg-card" data-testid="client-up-next">
          {rest.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-5 py-3">
              <Link
                to={c.stage === REVIEW_STAGE ? `${prefix}/review?task=${c.id}` : `${prefix}/brief-review?task=${c.id}`}
                className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
              >
                {c.title}
              </Link>
              <span className="text-xs text-muted-foreground">{c.stage === REVIEW_STAGE ? "Review" : "Brief"}</span>
              <DueLabel due={c.due_date} today={today} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
