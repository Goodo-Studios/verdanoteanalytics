import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ClientEmptyState } from "@/components/client/ClientEmptyState";

/**
 * "This Period's Highlights" — AI-drafted, strategist-published narrative (US-005).
 *
 * Presentational only. Two distinct surfaces driven by `isAuthor`:
 *
 *   - CLIENT (isAuthor=false): renders ONLY the published narrative via
 *     react-markdown. Never receives or renders draft_text, the editor, or the
 *     publish control. If there is no published text, shows a friendly
 *     onboarding line (no error, no empty box).
 *
 *   - STRATEGIST (isAuthor=true, builder/employee): additionally gets the
 *     authoring block — Generate draft (seeds via client-insights), an editor
 *     to revise the draft, and Publish (draft_text -> published_text).
 *
 * The authoring affordances are gated entirely on `isAuthor`; a real client
 * never has this prop set true, so the controls are absent from their DOM.
 */
export interface ClientHighlightsSectionProps {
  /** The client-visible, published narrative (markdown). */
  publishedText: string | null;
  periodLabel: string;
  isLoading?: boolean;

  /** Strategist authoring surface — omitted/false for clients. */
  isAuthor?: boolean;
  draftText?: string | null;
  status?: string;
  isGenerating?: boolean;
  isSaving?: boolean;
  isPublishing?: boolean;
  onGenerateDraft?: () => void;
  onSaveDraft?: (text: string) => void;
  onPublish?: (text: string) => void;
}

export function ClientHighlightsSection({
  publishedText,
  periodLabel,
  isLoading,
  isAuthor = false,
  draftText,
  status,
  isGenerating,
  isSaving,
  isPublishing,
  onGenerateDraft,
  onSaveDraft,
  onPublish,
}: ClientHighlightsSectionProps) {
  // Local editable copy of the draft, seeded from the persisted draft_text.
  const [editorValue, setEditorValue] = useState(draftText ?? "");

  useEffect(() => {
    setEditorValue(draftText ?? "");
  }, [draftText]);

  return (
    <div className="glass-panel p-7 space-y-4" data-testid="client-highlights">
      <div>
        <h2 className="font-heading text-[20px] text-forest">This Period&rsquo;s Highlights</h2>
        <p className="font-body text-[13px] text-slate font-light mt-0.5">{periodLabel}</p>
      </div>

      {isLoading ? (
        <div className="h-20 rounded-[8px] bg-muted animate-pulse" />
      ) : publishedText ? (
        <div className="prose prose-sm max-w-none font-body text-[14px] text-charcoal">
          <ReactMarkdown>{publishedText}</ReactMarkdown>
        </div>
      ) : (
        !isAuthor && (
          <ClientEmptyState
            icon={Sparkles}
            heading="Your strategist is preparing your first highlights"
            subcopy="A short, plain-language recap of how your creative is performing will land here once it&rsquo;s ready."
          />
        )
      )}

      {isAuthor && (
        <div
          className="mt-2 space-y-3 rounded-[8px] border border-border-light bg-card/60 p-4"
          data-testid="highlights-author-controls"
        >
          <div className="flex items-center justify-between">
            <p className="font-label text-[10px] uppercase tracking-[0.06em] text-sage font-medium">
              Strategist tools
            </p>
            {status === "published" && (
              <span className="font-body text-[11px] text-verdant">Published</span>
            )}
          </div>

          <Textarea
            aria-label="Highlights draft"
            value={editorValue}
            onChange={(e) => setEditorValue(e.target.value)}
            placeholder="Generate a draft, then revise it here before publishing for the client."
            className="min-h-[140px] font-body text-[14px]"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isGenerating}
              onClick={() => onGenerateDraft?.()}
            >
              {isGenerating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Generate draft
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSaving}
              onClick={() => onSaveDraft?.(editorValue)}
            >
              {isSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save draft
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isPublishing || !editorValue.trim()}
              onClick={() => onPublish?.(editorValue)}
            >
              {isPublishing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Publish
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ClientHighlightsSection;
