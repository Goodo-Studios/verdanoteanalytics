// Review (OS-019): tasks in Client Review, oldest due first. Each shows the asset link, the client
// comment thread, and Approve / Request changes (with a note). Replaces the ClickUp client review view.
// A client cannot change the title, date or status here; the only writes are a decision and a comment.
import { memo, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-kit";
import { useAuth } from "@/contexts/AuthContext";
import { useClientCards, useClientComments, useClientDecide, usePostClientComment } from "@/hooks/useClientCards";
import { MAX_NOTE, noteProblem, reviewCards, type ClientCard } from "@/lib/clientPages";
import { shortDate, todayIso } from "@/lib/homeData";
import { AssetLink, ClientCardShell, DueLabel, PageIntro } from "./ClientCardBits";

function Comments({ taskId }: { taskId: string }) {
  const { user } = useAuth();
  const comments = useClientComments(taskId, user?.id ?? null);
  const post = usePostClientComment(taskId);
  const [text, setText] = useState("");
  return (
    <div className="mt-4 border-t border-[var(--gos-line,#e9e5de)] pt-4" data-testid="client-comments">
      <p className="text-[11px] font-medium uppercase tracking-widest text-sage">Comments</p>
      {comments.isLoading ? null : comments.isError ? (
        <p className="mt-2 text-sm text-muted-foreground">Comments could not load.</p>
      ) : (comments.data ?? []).length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {(comments.data ?? []).map((c) => (
            <li key={c.id} className="text-sm" data-testid="client-comment">
              <span className="text-xs text-muted-foreground">{c.mine ? "You" : "Goodo"}, {shortDate(c.created_at)}: </span>
              <span className="whitespace-pre-wrap">{c.body}</span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const body = text.trim();
          if (!body) return;
          post.mutate(body, { onSuccess: () => setText("") });
        }}
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a comment"
          aria-label="Add a comment"
          rows={1}
          className="min-h-[38px] flex-1"
        />
        <Button type="submit" variant="outline" size="sm" disabled={!text.trim() || post.isPending}>
          Send
        </Button>
      </form>
      {post.isError ? <p className="mt-1 text-xs text-[var(--gos-late)]">{(post.error as Error).message}</p> : null}
    </div>
  );
}

export const ReviewCard = memo(function ReviewCard({ card, today }: { card: ClientCard; today: string }) {
  const decide = useClientDecide();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const send = (decision: "approved" | "changes_requested") => {
    const p = noteProblem(decision, note);
    setProblem(p);
    if (p) return;
    decide.mutate({ taskId: card.id, decision, note: decision === "approved" ? undefined : note.trim() });
  };

  return (
    <ClientCardShell testId="client-review-card">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-medium" data-testid="client-card-title">{card.title}</span>
        <DueLabel due={card.due_date} today={today} />
      </div>
      <div className="mt-2">
        {card.asset_url ? <AssetLink href={card.asset_url}>Open the asset</AssetLink> : <span className="text-sm text-muted-foreground">The asset link is on its way.</span>}
      </div>
      {decide.isSuccess ? (
        <p className="mt-4 text-sm text-forest" data-testid="client-decision-sent">Thanks, we have your answer.</p>
      ) : (
        <div className="mt-4 space-y-2" data-testid="client-decision">
          {asking ? (
            <>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What should we change?"
                aria-label="What should we change?"
                maxLength={MAX_NOTE + 50}
                rows={3}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => send("changes_requested")} disabled={decide.isPending}>
                  Send change request
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setAsking(false); setProblem(null); }}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" className="bg-verdant text-white hover:bg-verdant/90" onClick={() => send("approved")} disabled={decide.isPending}>
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAsking(true)} disabled={decide.isPending}>
                Request changes
              </Button>
            </div>
          )}
          {problem || decide.isError ? (
            <p className="text-xs text-[var(--gos-late)]" role="alert">{problem ?? (decide.error as Error).message}</p>
          ) : null}
        </div>
      )}
      <Comments taskId={card.id} />
    </ClientCardShell>
  );
});

export default function ClientReviewPage() {
  const cards = useClientCards();
  const [params] = useSearchParams();
  const focus = params.get("task");
  const today = todayIso();
  const review = useMemo(() => {
    const list = reviewCards(cards.data ?? []);
    // The task opened from home goes first.
    const i = focus ? list.findIndex((c) => c.id === focus) : -1;
    return i > 0 ? [list[i], ...list.slice(0, i), ...list.slice(i + 1)] : list;
  }, [cards.data, focus]);

  return (
    <div className="max-w-3xl space-y-4" data-testid="client-review-page">
      <PageIntro title="Review" description="Work ready for your review. Approve it or tell us what to change." />
      {cards.isLoading ? (
        <LoadingState />
      ) : cards.isError ? (
        <ErrorState title="We could not load your reviews." message="Please try again." onRetry={() => void cards.refetch()} />
      ) : review.length === 0 ? (
        <EmptyState title="Nothing to review right now" description="Work shows here when it is ready for you." />
      ) : (
        <div className="space-y-3">
          {review.map((c) => (
            <ReviewCard key={c.id} card={c} today={today} />
          ))}
        </div>
      )}
    </div>
  );
}
