import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  PLATFORM_COLORS,
  PLATFORM_LABELS,
} from "@/features/vault/types/vault";
import {
  FrameworkPanel,
  type FrameworkRow,
} from "@/features/vault/components/FrameworkPanel";

// Shape returned by the vault-share-item `resolve` action. Mirrors the edge
// function's PUBLIC_ITEM_COLUMNS allowlist (no internal fields).
interface PublicItem {
  id: string;
  platform: string | null;
  creator_handle: string | null;
  title: string | null;
  source_url: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  file_path: string | null;
  ad_body_text: string | null;
  brand_name: string | null;
  industry: string | null;
  ad_format: string | null;
  target_audience: string | null;
  script_analysis: string | null;
  visual_analysis: string | null;
  status: string;
  created_at: string;
}

interface ResolveResponse {
  item: PublicItem;
  transcript: {
    cleaned_script: string | null;
    duration_seconds: number | null;
    word_count: number | null;
  } | null;
  framework: FrameworkRow | null;
  signed_url: string | null;
}

/**
 * Public, no-login view of a single shared vault item. Resolves the share token
 * through the vault-share-item edge function (which signs private media + omits
 * internal fields) and renders the full creative + AI analysis read-only.
 */
export default function PublicVaultItemPage() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-vault-item", token],
    enabled: !!token,
    retry: false,
    queryFn: async (): Promise<ResolveResponse> => {
      const { data, error } = await supabase.functions.invoke("vault-share-item", {
        body: { action: "resolve", token },
      });
      if (error) throw error;
      return data as ResolveResponse;
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data?.item) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <AlertCircle className="w-8 h-8 text-destructive" />
        <p className="text-muted-foreground">
          This share link is no longer available.
        </p>
      </div>
    );
  }

  const { item, transcript, framework, signed_url } = data;
  const platformKey = item.platform ?? "unknown";
  const isImageFile = /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(item.file_path ?? "");
  const imageSrc = (isImageFile ? signed_url : null) ?? item.thumbnail_url ?? null;
  const videoSrc = !isImageFile ? (item.video_url ?? signed_url ?? null) : null;
  const createdAt = new Date(item.created_at);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <header className="flex items-center gap-2 mb-6">
          <span
            className={cn(
              "text-xs font-medium px-2 py-0.5 rounded-full shrink-0",
              PLATFORM_COLORS[platformKey] ?? PLATFORM_COLORS.unknown,
            )}
          >
            {PLATFORM_LABELS[platformKey] ?? PLATFORM_LABELS.unknown}
          </span>
          {item.creator_handle && (
            <span className="text-sm text-muted-foreground truncate">
              @{item.creator_handle}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {createdAt.toLocaleDateString()}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            Shared via Verdanote
          </span>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-8">
          {/* Left: preview */}
          <div className="space-y-4">
            <div className="rounded-xl overflow-hidden bg-muted aspect-[9/16]">
              {videoSrc ? (
                <video
                  src={videoSrc}
                  controls
                  poster={item.thumbnail_url ?? undefined}
                  className="w-full h-full object-contain"
                />
              ) : imageSrc ? (
                <img
                  src={imageSrc}
                  alt={item.title ?? "Inspiration"}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                  No preview
                </div>
              )}
            </div>
            {item.ad_body_text && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Ad copy
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap rounded-lg bg-muted p-3">
                  {item.ad_body_text}
                </p>
              </div>
            )}
          </div>

          {/* Right: metadata + tabs */}
          <div>
            <div className="mb-6 space-y-1">
              {(item.brand_name || item.title) && (
                <h1 className="text-xl font-bold leading-snug">
                  {item.brand_name ?? item.title}
                </h1>
              )}
              {(item.industry || item.ad_format) && (
                <div className="flex flex-wrap gap-1.5">
                  {item.industry && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">
                      {item.industry}
                    </span>
                  )}
                  {item.ad_format && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">
                      {item.ad_format}
                    </span>
                  )}
                </div>
              )}
              {item.target_audience && (
                <p className="text-sm text-muted-foreground">
                  {item.target_audience}
                </p>
              )}
            </div>

            <Tabs.Root
              defaultValue={
                framework ? "framework" : transcript ? "script" : "analysis"
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
                {transcript?.cleaned_script ? (
                  <div className="space-y-2">
                    <p className="w-full text-sm leading-relaxed text-foreground bg-muted rounded-lg p-4 whitespace-pre-wrap">
                      {transcript.cleaned_script}
                    </p>
                    {(transcript.duration_seconds || transcript.word_count) && (
                      <p className="text-xs text-muted-foreground">
                        {transcript.duration_seconds
                          ? `${Math.round(transcript.duration_seconds)}s · `
                          : ""}
                        {transcript.word_count ?? 0} words
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">No transcript.</p>
                )}
              </Tabs.Content>

              <Tabs.Content value="framework">
                {framework ? (
                  <FrameworkPanel framework={framework} />
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No framework extracted.
                  </p>
                )}
              </Tabs.Content>

              <Tabs.Content value="analysis">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Script Analysis
                    </h3>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap rounded-lg bg-muted p-4">
                      {item.script_analysis || "—"}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-sky-600 dark:text-sky-400">
                      Visual Analysis
                    </h3>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap rounded-lg bg-muted p-4 border border-sky-200 dark:border-sky-900">
                      {item.visual_analysis || "—"}
                    </p>
                  </div>
                </div>
              </Tabs.Content>
            </Tabs.Root>
          </div>
        </div>
      </div>
    </div>
  );
}
