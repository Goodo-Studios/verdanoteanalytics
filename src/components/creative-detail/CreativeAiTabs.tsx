import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, Loader2, RefreshCw, Share2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { FrameworkPanel } from "@/features/vault/components/FrameworkPanel";
import { CopyButton } from "@/features/vault/components/CopyButton";
import { AddToBoardModal } from "@/features/vault/components/AddToBoardModal";
import { VaultShareControl } from "@/features/vault/components/VaultShareControl";
import { PLATFORM_LABELS, PLATFORM_COLORS } from "@/features/vault/types/vault";
import {
  creativeAiDetailKey,
  type CreativeAiDetail,
} from "@/hooks/useCreativeAiDetail";

/**
 * Full-parity AI tabs for the analytics creative modal, mirroring the live
 * Creative Vault detail view (ItemDetailPage + FrameworkPanel). Where the Vault
 * reads/writes inspiration_items + inspiration_frameworks + inspiration_transcripts,
 * these tabs read/write the equivalent columns promoted onto `public.creatives`
 * (migrations 20260722000007 + 20260723000004). Builders/employees edit inline;
 * clients (read-only role) see the same panels without edit affordances.
 *
 *   • Script    — cleaned script (creatives.transcript) + client word count + copy
 *   • Framework — the editable Vault FrameworkPanel (fields save back to creatives;
 *                 hook stars toggle hook_verbal_saved / hook_text_saved / hook_visual_saved)
 *   • Analysis  — Script analysis (ai_analysis) + Visual analysis (ai_visual_notes)
 *
 * Data arrives via the lazy useCreativeAiDetail fetch (keyed by ad_id); saves
 * invalidate that key so the panels reflect the persisted value.
 */

interface TabProps {
  adId: string;
  detail: CreativeAiDetail | null | undefined;
  isLoading: boolean;
  /** Builder/employee — gates inline editing. Clients get read-only panels. */
  canEdit: boolean;
}

/** "analyzing"/"pending"-style statuses that mean a result is still coming. */
function isProcessingStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === "analyzing" || s === "processing" || s === "pending" || s === "queued";
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground font-body text-[13px]">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="font-body text-[13px] text-muted-foreground">{message}</p>;
}

/** Count words in a script the same way a human would — whitespace-delimited. */
function wordCount(text: string | null | undefined): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// ── Shared write helpers ─────────────────────────────────────────────────────

/** Update a single column on the creatives row (by ad_id) and refresh the
 * lazy AI-detail cache. Builder/employee RLS authorises the write server-side. */
function useSaveCreativeField(adId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      field,
      value,
    }: {
      field: string;
      value: string | boolean | null;
    }) => {
      const { error } = await supabase
        .from("creatives")
        .update({ [field]: value })
        .eq("ad_id", adId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: creativeAiDetailKey(adId) });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to save"),
  });
}

// ── Script tab ───────────────────────────────────────────────────────────────
export function CreativeScriptTab({ adId, detail, isLoading, canEdit }: TabProps) {
  const save = useSaveCreativeField(adId);
  const [draft, setDraft] = useState("");
  const initialisedFor = useRef<string | null>(null);

  // (Re)initialise the draft when the detail first resolves for this creative,
  // or when a re-analyze rewrites the transcript. Never clobber in-flight edits.
  useEffect(() => {
    if (!detail) return;
    if (initialisedFor.current === adId) return;
    setDraft(detail.transcript ?? "");
    initialisedFor.current = adId;
  }, [detail, adId]);

  if (isLoading) return <LoadingState label="Loading script…" />;

  const persisted = detail?.transcript ?? "";
  const hasScript = !!persisted.trim() || !!draft.trim();

  if (!hasScript && !canEdit) {
    return (
      <EmptyState
        message={
          isProcessingStatus(detail?.transcript_status)
            ? "Transcribing…"
            : "No transcript for this creative."
        }
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <div className="absolute top-2 right-2 z-10">
          <CopyButton text={draft} />
        </div>
        {canEdit ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== persisted) {
                save.mutate({ field: "transcript", value: draft || null });
              }
            }}
            placeholder="No script extracted yet."
            className="w-full min-h-[300px] font-sans text-sm leading-relaxed text-foreground bg-muted rounded-lg p-4 pr-9 border-0 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
          />
        ) : (
          <p className="w-full min-h-[120px] text-sm leading-relaxed whitespace-pre-wrap text-foreground bg-muted rounded-lg p-4 pr-9">
            {persisted || "No script extracted yet."}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{wordCount(draft)} words</p>
    </div>
  );
}

// ── Framework tab ─────────────────────────────────────────────────────────────
export function CreativeFrameworkTab({ adId, detail, isLoading, canEdit }: TabProps) {
  const save = useSaveCreativeField(adId);
  const toggleStar = useSaveCreativeField(adId);
  const queryClient = useQueryClient();

  const hasFramework =
    !!detail &&
    !!(
      detail.copywriting_framework ||
      detail.hook_type ||
      detail.hook_verbal ||
      detail.hook_text ||
      detail.hook_visual ||
      detail.hook_formula ||
      detail.value_structure ||
      detail.cta_type ||
      detail.cta_formula ||
      detail.fill_in_blank_script
    );

  if (isLoading) return <LoadingState label="Loading framework…" />;
  // Read-only viewers see the empty state when there's nothing extracted; editors
  // always get the editable panel so they can author a framework by hand.
  if (!hasFramework && !canEdit) {
    return (
      <EmptyState
        message={
          isProcessingStatus(detail?.analysis_status)
            ? "Analysis in progress…"
            : "Not analyzed yet."
        }
      />
    );
  }

  return (
    <FrameworkPanel
      framework={{
        id: adId,
        item_id: adId,
        copywriting_framework: detail?.copywriting_framework ?? null,
        hook_type: detail?.hook_type ?? null,
        hook_verbal: detail?.hook_verbal ?? null,
        hook_text: detail?.hook_text ?? null,
        hook_visual: detail?.hook_visual ?? null,
        hook_formula: detail?.hook_formula ?? null,
        value_structure: detail?.value_structure ?? null,
        cta_type: detail?.cta_type ?? null,
        cta_formula: detail?.cta_formula ?? null,
        fill_in_blank_script: detail?.fill_in_blank_script ?? null,
      }}
      hookVerbalSaved={detail?.hook_verbal_saved ?? false}
      hookTextSaved={detail?.hook_text_saved ?? false}
      hookVisualSaved={detail?.hook_visual_saved ?? false}
      onSave={
        canEdit
          ? (field, value) => save.mutate({ field: field as string, value })
          : undefined
      }
      onToggleHookStar={
        canEdit
          ? (field, value) => {
              toggleStar.mutate(
                { field, value },
                {
                  onSuccess: () => {
                    // Bust the Hook Library cache so a new star shows there too.
                    queryClient.invalidateQueries({ queryKey: ["vault-hooks"] });
                    toast.success(value ? "Hook saved to library" : "Removed from library");
                  },
                },
              );
            }
          : undefined
      }
    />
  );
}

// ── Analysis tab ──────────────────────────────────────────────────────────────
function AnalysisSection({
  label,
  field,
  value,
  accent,
  canEdit,
  onSave,
}: {
  label: string;
  field: "ai_analysis" | "ai_visual_notes";
  value: string | null;
  accent?: boolean;
  canEdit: boolean;
  onSave: (field: string, value: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const initialised = useRef(false);

  useEffect(() => {
    if (initialised.current) return;
    setDraft(value ?? "");
    initialised.current = true;
  }, [value]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3
          className={cn(
            "text-xs font-semibold uppercase tracking-widest",
            accent ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground",
          )}
        >
          {label}
        </h3>
        <CopyButton text={draft} />
      </div>
      {canEdit ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== (value ?? "")) onSave(field, draft || null);
          }}
          placeholder={`No ${label.toLowerCase()} yet.`}
          className={cn(
            "w-full min-h-[180px] text-sm leading-relaxed whitespace-pre-wrap rounded-lg bg-muted p-4 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y",
            accent
              ? "border border-sky-200 dark:border-sky-900"
              : "border-0",
          )}
        />
      ) : (
        <p
          className={cn(
            "text-sm leading-relaxed whitespace-pre-wrap rounded-lg bg-muted p-4",
            accent && "border border-sky-200 dark:border-sky-900",
            !value && "text-muted-foreground italic",
          )}
        >
          {value || `No ${label.toLowerCase()} yet.`}
        </p>
      )}
    </div>
  );
}

export function CreativeAnalysisTab({ adId, detail, isLoading, canEdit }: TabProps) {
  const save = useSaveCreativeField(adId);
  const onSave = (field: string, value: string | null) =>
    save.mutate({ field, value });

  const hasAnalysis = !!detail && !!(detail.ai_analysis || detail.ai_visual_notes);

  if (isLoading) return <LoadingState label="Loading analysis…" />;
  if (!hasAnalysis && !canEdit) {
    return (
      <EmptyState
        message={
          isProcessingStatus(detail?.analysis_status)
            ? "Analysis in progress…"
            : "Not analyzed yet."
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <AnalysisSection
        label="Script Analysis"
        field="ai_analysis"
        value={detail?.ai_analysis ?? null}
        canEdit={canEdit}
        onSave={onSave}
      />
      <AnalysisSection
        label="Visual Analysis"
        field="ai_visual_notes"
        value={detail?.ai_visual_notes ?? null}
        accent
        canEdit={canEdit}
        onSave={onSave}
      />
    </div>
  );
}

// ── Vault-parity header + action row ─────────────────────────────────────────
interface HeaderProps {
  adId: string;
  accountId: string;
  /** Platform string on the creatives row (Meta ad analytics → "facebook_ad"). */
  platform: string | null;
  /** Ad creation time (falls back to row creation). */
  dateIso: string | null;
  detail: CreativeAiDetail | null | undefined;
  canEdit: boolean;
  /** inspiration_items.id if this creative has been saved to the Vault, else null. */
  vaultItemId: string | null;
  /** Current share token on the vault item (null when unshared / not saved). */
  vaultShareToken: string | null;
}

/**
 * The Vault-parity metadata block + action row that sits above the tabs:
 *   platform badge · date · brand · industry/ad_format chips · target-audience
 *   Re-analyze · Add to board · Share
 *
 * Add-to-board and Share reuse the REAL Vault components (AddToBoardModal /
 * VaultShareControl), which operate on an inspiration_items id — so they are
 * enabled only once the creative has been saved to the Vault (vaultItemId set).
 * Before then they render disabled with a "Save to Vault first" hint rather than
 * fabricating an account-side board/share backend.
 */
export function CreativeAiHeader({
  adId,
  accountId,
  platform,
  dateIso,
  detail,
  canEdit,
  vaultItemId,
  vaultShareToken,
}: HeaderProps) {
  const queryClient = useQueryClient();
  const [addToBoardOpen, setAddToBoardOpen] = useState(false);

  const reanalyze = useMutation({
    mutationFn: async () => {
      // Authoritative step: re-queue this creative for the analyze-creative drain.
      // Mirrors the drain's own recycle path (analysis_status='pending') so the
      // next run re-processes it; clearing analyzed_at marks it un-analyzed.
      const { error } = await supabase
        .from("creatives")
        .update({ analysis_status: "pending", analyzed_at: null })
        .eq("ad_id", adId);
      if (error) throw error;
      // Best-effort poke so the drain picks it up promptly. The single-flight /
      // budget guards inside analyze-creative may skip this poke, but the row is
      // already 'pending' so the 5-min cron will still process it — never stuck.
      await supabase.functions
        .invoke("analyze-creative", { body: { account_id: accountId } })
        .catch(() => {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: creativeAiDetailKey(adId) });
      queryClient.invalidateQueries({ queryKey: ["creatives"] });
      toast.success("Re-analysis queued");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Re-analyze failed"),
  });

  const platformKey = platform ?? "facebook_ad";
  const platformLabel = PLATFORM_LABELS[platformKey] ?? "Meta Ad";
  const platformColor = PLATFORM_COLORS[platformKey] ?? PLATFORM_COLORS.unknown;
  const date = dateIso ? new Date(dateIso) : null;
  const boardShareEnabled = !!vaultItemId;

  return (
    <div className="mb-4 space-y-3">
      {/* Metadata: platform · date · brand · chips · audience */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              "text-xs font-medium px-2 py-0.5 rounded-full shrink-0",
              platformColor ?? PLATFORM_COLORS.unknown,
            )}
          >
            {platformLabel}
          </span>
          {date && (
            <span className="text-xs text-muted-foreground">
              {date.toLocaleDateString()}
            </span>
          )}
        </div>

        {detail?.brand_name && (
          <h2 className="text-xl font-bold leading-snug">{detail.brand_name}</h2>
        )}

        {(detail?.industry || detail?.ad_format) && (
          <div className="flex flex-wrap gap-1.5">
            {detail.industry && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">
                {detail.industry}
              </span>
            )}
            {detail.ad_format && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">
                {detail.ad_format}
              </span>
            )}
          </div>
        )}

        {detail?.target_audience && (
          <p className="text-sm text-muted-foreground">{detail.target_audience}</p>
        )}
      </div>

      {/* Action row: Re-analyze · Add to board · Share (staff only) */}
      {canEdit && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => reanalyze.mutate()}
            disabled={reanalyze.isPending}
            aria-label="Re-analyze creative"
            className={cn(
              "flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors",
              reanalyze.isPending ? "opacity-50 cursor-not-allowed" : "hover:bg-muted",
            )}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", reanalyze.isPending && "animate-spin")} />
            {reanalyze.isPending ? "Queuing…" : "Re-analyze"}
          </button>

          <button
            onClick={() => setAddToBoardOpen(true)}
            disabled={!boardShareEnabled}
            aria-label="Add to board"
            title={boardShareEnabled ? undefined : "Save to Vault first to add to a board"}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors",
              boardShareEnabled ? "hover:bg-muted" : "opacity-50 cursor-not-allowed",
            )}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Add to board
          </button>

          {boardShareEnabled ? (
            <VaultShareControl itemId={vaultItemId!} shareToken={vaultShareToken} />
          ) : (
            <button
              disabled
              aria-label="Share"
              title="Save to Vault first to share"
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium opacity-50 cursor-not-allowed"
            >
              <Share2 className="w-3.5 h-3.5" />
              Share
            </button>
          )}
        </div>
      )}

      {boardShareEnabled && (
        <AddToBoardModal
          itemId={vaultItemId}
          open={addToBoardOpen}
          onOpenChange={setAddToBoardOpen}
        />
      )}
    </div>
  );
}
