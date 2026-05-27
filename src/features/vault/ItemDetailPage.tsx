import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  LayoutGrid,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRolePrefix } from "@/hooks/useRolePath";
import { cn } from "@/lib/utils";
import {
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  STATUS_LABELS,
  VAULT_PROCESSING_STATUSES,
  type InspirationItem,
} from "./types/vault";
import { useItemStatus } from "./hooks/useItemStatus";
import { FrameworkPanel, type FrameworkRow } from "./components/FrameworkPanel";
import { TagInput } from "./components/TagInput";
import { AddToBoardModal } from "./components/AddToBoardModal";

interface TranscriptRow {
  id: string;
  item_id: string;
  cleaned_script: string | null;
  duration_seconds?: number | null;
  word_count?: number | null;
}

type ItemDetail = InspirationItem & {
  inspiration_transcripts: TranscriptRow[];
  inspiration_frameworks: FrameworkRow[];
};

/** Item detail page for a Vault inspiration item.
 *
 * Matches the route LibraryPage's InspirationCard links to:
 *   `${prefix}/ad-library/:id`.
 *
 * Behaviour parity with Creative Vault's ItemDetailPage stripped to the
 * surface area US-007 calls for:
 *   • Preview (video or thumbnail), platform badge, creator handle, source link
 *   • Inline tag editing (TagInput)
 *   • Tabs: Script · Framework · Analysis
 *   • Re-analyze button → calls vault-analyze edge function
 *   • Back navigation that uses browser history (preserves library scroll)
 */
export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const prefix = useRolePrefix();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Local optimistic flag so the re-analyze button disables immediately even
  // before the item row's status flips on the server.
  const [reanalyzeInFlight, setReanalyzeInFlight] = useState(false);
  const [addToBoardOpen, setAddToBoardOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["vault-item", id],
    enabled: !!id && !!user,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase
        .from("inspiration_items")
        .select(
          `*,
           inspiration_transcripts(*),
           inspiration_frameworks(*)`,
        )
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as ItemDetail;
    },
  });

  const isProcessing = data ? VAULT_PROCESSING_STATUSES.has(data.status) : false;
  // Poll while the item is mid-pipeline so Transcript/Framework/Analysis tabs
  // populate without a manual refresh.
  useItemStatus(isProcessing ? (id ?? null) : null);

  // Reset the local in-flight flag once the server flips status off
  // "analyzing" — the row update arrives via the useItemStatus poller.
  useEffect(() => {
    if (data && !VAULT_PROCESSING_STATUSES.has(data.status)) {
      setReanalyzeInFlight(false);
    }
  }, [data]);

  // Signed URL for storage-backed media (used when the row doesn't carry a
  // public `video_url`).
  const { data: signedUrl } = useQuery({
    queryKey: ["vault-item-signed-url", data?.file_path],
    enabled: !!data?.file_path && !data?.video_url,
    staleTime: 50 * 60 * 1000,
    queryFn: async () => {
      const { data: result, error } = await supabase.storage
        .from("inspiration-media")
        .createSignedUrl(data!.file_path!, 3600);
      if (error) throw error;
      return result.signedUrl;
    },
  });

  const reanalyze = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("No item id");
      setReanalyzeInFlight(true);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: delErr } = await supabase
        .from("inspiration_frameworks")
        .delete()
        .eq("item_id", id);
      if (delErr) throw delErr;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: statusData, error: statusErr } = await supabase
        .from("inspiration_items")
        .update({ status: "analyzing", error_message: null })
        .eq("id", id)
        .select("id");
      if (statusErr) throw statusErr;
      if (!statusData?.length) {
        throw new Error("Re-analyze failed — could not update item status");
      }

      queryClient.invalidateQueries({ queryKey: ["vault-item", id] });

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch(`${supabaseUrl}/functions/v1/vault-analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ item_id: id }),
      });
      // Don't await JSON — vault-analyze writes to the DB and we'll pick up the
      // result via the polling hook. But we do need to surface non-2xx errors.
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `vault-analyze returned ${res.status}`);
      }
    },
    onSuccess: () => {
      toast.success("Re-analysis kicked off");
    },
    onError: (err) => {
      setReanalyzeInFlight(false);
      toast.error(err instanceof Error ? err.message : "Re-analyze failed");
    },
  });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (error || !data) {
    return (
      <AppLayout>
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <p className="text-muted-foreground">Item not found</p>
          <Link
            to={`${prefix}/ad-library`}
            className="text-primary text-sm hover:underline"
          >
            Back to library
          </Link>
        </div>
      </AppLayout>
    );
  }

  const transcriptRow = data.inspiration_transcripts?.[0] ?? null;
  const frameworkRow = data.inspiration_frameworks?.[0] ?? null;
  const platformKey = data.platform ?? "unknown";
  const reanalyzeDisabled = reanalyzeInFlight || reanalyze.isPending || isProcessing;
  const createdAt = new Date(data.created_at);

  // Use browser history for back navigation so the library page restores its
  // scroll position. Fall back to the library route if there's no history.
  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(`${prefix}/ad-library`);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header bar */}
        <header className="flex items-center gap-3 mb-6">
          <button
            onClick={handleBack}
            className="p-1.5 rounded hover:bg-muted transition-colors"
            aria-label="Back to library"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span
              className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-full shrink-0",
                PLATFORM_COLORS[platformKey] ?? PLATFORM_COLORS.unknown,
              )}
            >
              {PLATFORM_LABELS[platformKey] ?? PLATFORM_LABELS.unknown}
            </span>
            {data.creator_handle && (
              <span className="text-sm text-muted-foreground truncate">
                @{data.creator_handle}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {createdAt.toLocaleDateString()}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {data.source_url && (
                <a
                  href={data.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground"
                  title="Open original"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-8">
          {/* Left: preview + tags */}
          <div className="space-y-4">
            <div className="rounded-xl overflow-hidden bg-muted aspect-[9/16]">
              {data.video_url || signedUrl ? (
                <video
                  src={data.video_url ?? signedUrl ?? undefined}
                  controls
                  poster={data.thumbnail_url ?? undefined}
                  className="w-full h-full object-contain"
                />
              ) : data.thumbnail_url ? (
                <img
                  src={data.thumbnail_url}
                  alt={data.title ?? "Inspiration"}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                  No preview
                </div>
              )}
            </div>

            {data.status !== "ready" && (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                  data.status === "error"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                )}
                <span>{STATUS_LABELS[data.status] ?? data.status}</span>
                {data.error_message && (
                  <span className="text-xs break-words">{data.error_message}</span>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Tags
              </p>
              <TagInput itemId={data.id} />
            </div>
          </div>

          {/* Right: metadata + tabs */}
          <div>
            <div className="mb-6 space-y-1">
              {data.brand_name && (
                <h2 className="text-xl font-bold leading-snug">
                  {data.brand_name}
                </h2>
              )}
              {data.title && !data.brand_name && (
                <h2 className="text-xl font-bold leading-snug">{data.title}</h2>
              )}
              {(data.industry || data.ad_format) && (
                <div className="flex flex-wrap gap-1.5">
                  {data.industry && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">
                      {data.industry}
                    </span>
                  )}
                  {data.ad_format && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">
                      {data.ad_format}
                    </span>
                  )}
                </div>
              )}
              {data.target_audience && (
                <p className="text-sm text-muted-foreground">
                  {data.target_audience}
                </p>
              )}
            </div>

            {/* Re-analyze action — disabled while pipeline is in flight or no
                framework can be regenerated yet. */}
            <div className="mb-6 flex items-center gap-3">
              <button
                onClick={() => reanalyze.mutate()}
                disabled={reanalyzeDisabled}
                aria-label="Re-analyze item"
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors",
                  reanalyzeDisabled
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:bg-muted",
                )}
              >
                <RefreshCw
                  className={cn(
                    "w-3.5 h-3.5",
                    (reanalyze.isPending || reanalyzeInFlight) && "animate-spin",
                  )}
                />
                {reanalyzeInFlight || isProcessing
                  ? "Analyzing…"
                  : frameworkRow
                    ? "Re-analyze"
                    : "Run analysis"}
              </button>
              <button
                onClick={() => setAddToBoardOpen(true)}
                aria-label="Add to board"
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Add to board
              </button>
              {!frameworkRow && !isProcessing && (
                <span className="text-xs text-muted-foreground">
                  No framework yet — click to run vault-analyze.
                </span>
              )}
            </div>

            <Tabs.Root
              defaultValue={
                frameworkRow
                  ? "framework"
                  : transcriptRow
                    ? "script"
                    : "analysis"
              }
            >
              <Tabs.List className="flex border-b border-border mb-6">
                {(["script", "framework", "analysis"] as const).map((t) => (
                  <Tabs.Trigger
                    key={t}
                    value={t}
                    className="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors data-[state=active]:border-primary data-[state=active]:text-primary border-transparent text-muted-foreground hover:text-foreground capitalize"
                  >
                    {t}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>

              <Tabs.Content value="script">
                {transcriptRow ? (
                  <div className="space-y-2">
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground bg-muted rounded-lg p-4">
                      {transcriptRow.cleaned_script || (
                        <span className="text-muted-foreground italic">
                          No script extracted yet.
                        </span>
                      )}
                    </pre>
                    {(transcriptRow.duration_seconds ||
                      transcriptRow.word_count) && (
                      <p className="text-xs text-muted-foreground">
                        {transcriptRow.duration_seconds
                          ? `${Math.round(transcriptRow.duration_seconds)}s · `
                          : ""}
                        {transcriptRow.word_count ?? 0} words
                      </p>
                    )}
                  </div>
                ) : isProcessing ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing…
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No transcript yet.
                  </p>
                )}
              </Tabs.Content>

              <Tabs.Content value="framework">
                {frameworkRow ? (
                  <FrameworkPanel framework={frameworkRow} />
                ) : isProcessing ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Extracting framework…
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No framework extracted yet. Click "Run analysis" above.
                  </p>
                )}
              </Tabs.Content>

              <Tabs.Content value="analysis">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Script Analysis
                    </h3>
                    <p
                      className={cn(
                        "text-sm leading-relaxed whitespace-pre-wrap rounded-lg bg-muted p-4",
                        data.script_analysis
                          ? "text-foreground"
                          : "text-muted-foreground italic",
                      )}
                    >
                      {data.script_analysis || "No script analysis yet."}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-sky-600 dark:text-sky-400">
                      Visual Analysis
                    </h3>
                    <p
                      className={cn(
                        "text-sm leading-relaxed whitespace-pre-wrap rounded-lg bg-muted p-4 border border-sky-200 dark:border-sky-900",
                        data.visual_analysis
                          ? "text-foreground"
                          : "text-muted-foreground italic",
                      )}
                    >
                      {data.visual_analysis || "No visual analysis yet."}
                    </p>
                  </div>
                </div>
              </Tabs.Content>
            </Tabs.Root>
          </div>
        </div>
      </div>

      <AddToBoardModal
        itemId={data.id}
        open={addToBoardOpen}
        onOpenChange={setAddToBoardOpen}
      />
    </AppLayout>
  );
}
