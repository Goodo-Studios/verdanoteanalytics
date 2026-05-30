import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  usePublishedHighlight,
  useHighlightDraft,
  useHighlightMutations,
} from "@/hooks/useClientHighlights";
import { ClientHighlightsSection } from "@/components/client/ClientHighlightsSection";

/** Current calendar month as a stable period key (e.g. "2026-05") + label. */
function currentPeriod(now = new Date()): { period: string; label: string } {
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const label = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return { period, label };
}

/**
 * Data wrapper for "This Period's Highlights" (US-005).
 *
 * Authoring (draft/edit/publish) is gated on `isBuilder || isEmployee`. That
 * gate is independent of client-preview: a strategist previewing the client
 * surface still authors, while a REAL client (role === "client") never receives
 * authoring props and reads only the published narrative via the published view.
 */
export function ClientHighlightsContainer({ accountId }: { accountId?: string }) {
  const { isBuilder, isEmployee } = useAuth();
  const isAuthor = isBuilder || isEmployee;

  const { period, label } = useMemo(() => currentPeriod(), []);

  const { data: published, isLoading: publishedLoading } = usePublishedHighlight({
    accountId,
    period,
  });

  // Strategist-only read of the full draft row. Disabled for clients so the
  // base table is never queried from the client surface.
  const { data: draft } = useHighlightDraft({
    accountId,
    period,
    enabled: isAuthor,
  });

  const { generateDraft, saveDraft, publish } = useHighlightMutations({ accountId, period });

  // Client surface: published text only, no authoring props.
  if (!isAuthor) {
    return (
      <ClientHighlightsSection
        publishedText={published?.published_text ?? null}
        periodLabel={label}
        isLoading={publishedLoading}
      />
    );
  }

  // Strategist surface: published text + full authoring controls.
  return (
    <ClientHighlightsSection
      publishedText={published?.published_text ?? draft?.published_text ?? null}
      periodLabel={label}
      isLoading={publishedLoading}
      isAuthor
      draftText={draft?.draft_text ?? null}
      status={draft?.status}
      isGenerating={generateDraft.isPending}
      isSaving={saveDraft.isPending}
      isPublishing={publish.isPending}
      onGenerateDraft={() => generateDraft.mutate()}
      onSaveDraft={(text) => saveDraft.mutate(text)}
      onPublish={(text) => publish.mutate(text)}
    />
  );
}

export default ClientHighlightsContainer;
