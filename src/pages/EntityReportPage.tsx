import { useMemo, useState } from "react";
import { Loader2, Layers, ImageOff } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  type ConfidenceTier,
  type EntityCluster,
  type EntitySignal,
  useEntityClusterMembers,
  useEntityReport,
} from "@/hooks/useEntityReport";

// Builder-account-first rollout: the Entity Report ships gated to the Goodo
// builder account only (see roadmap §"Rollout sequencing"). Account ids are
// stored with the Meta `act_` prefix.

type TierFilter = "all" | ConfidenceTier;

const TIER_LABEL: Record<ConfidenceTier, string> = {
  exact: "Exact match",
  corroborated: "Corroborated",
  probable: "Probable",
  visual_only: "Visual only",
};

const TIER_VARIANT: Record<ConfidenceTier, "default" | "secondary" | "outline"> = {
  exact: "default",
  corroborated: "default",
  probable: "secondary",
  visual_only: "outline",
};

// Exact is the strongest, zero-model-cost tier (shared asset) — accent it apart
// from the model-similarity tiers so it reads as ground truth at a glance.
const TIER_CLASS: Partial<Record<ConfidenceTier, string>> = {
  exact: "bg-emerald-600 hover:bg-emerald-600 text-white border-transparent",
};

const SIGNAL_LABEL: Record<EntitySignal, string> = {
  exact: "Exact asset",
  visual: "Visual",
  script: "Script",
  destination: "Same destination",
};

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

// ─── Headline strip ──────────────────────────────────────────────────────────

function HeadlineStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        <div className="text-sm text-muted-foreground mt-1">{label}</div>
        {hint && <div className="text-xs text-muted-foreground/70 mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

// ─── Cluster card ─────────────────────────────────────────────────────────────

function ClusterCard({ cluster, onOpen }: { cluster: EntityCluster; onOpen: () => void }) {
  return (
    <Card className="overflow-hidden cursor-pointer hover:border-primary/40 transition-colors" onClick={onOpen}>
      <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
        {cluster.representative_thumbnail
          ? (
            <img
              src={cluster.representative_thumbnail}
              alt={cluster.label ?? "cluster"}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          )
          : <ImageOff className="h-8 w-8 text-muted-foreground/50" />}
      </div>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight line-clamp-2">
            {cluster.label || "Untitled entity"}
          </CardTitle>
          <Badge
            variant={TIER_VARIANT[cluster.confidence_tier]}
            className={TIER_CLASS[cluster.confidence_tier]}
          >
            {TIER_LABEL[cluster.confidence_tier]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground space-y-1">
        <div className="flex justify-between">
          <span>Creatives</span>
          <span className="text-foreground font-medium">{cluster.n_creatives}</span>
        </div>
        <div className="flex justify-between">
          <span>Spend</span>
          <span className="text-foreground font-medium">{fmtMoney(cluster.total_spend)}</span>
        </div>
        <div className="flex justify-between">
          <span>Spend share</span>
          <span className="text-foreground font-medium">{cluster.spend_share_pct}%</span>
        </div>
        <div className="flex justify-between">
          <span>Analyzed</span>
          <span className="text-foreground font-medium">
            {cluster.analyzed_members ?? 0}/{cluster.n_creatives}
          </span>
        </div>
        {(cluster.signals ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1.5">
            {(cluster.signals ?? []).map((s) => (
              <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                {SIGNAL_LABEL[s]}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Drill-in members dialog ─────────────────────────────────────────────────

function ClusterMembersDialog({
  accountId, cluster, onClose,
}: { accountId: string; cluster: EntityCluster | null; onClose: () => void }) {
  const { data: members, isLoading } = useEntityClusterMembers(accountId, cluster?.id);

  return (
    <Dialog open={!!cluster} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {cluster?.label || "Entity"}
            {cluster && (
              <Badge
                variant={TIER_VARIANT[cluster.confidence_tier]}
                className={TIER_CLASS[cluster.confidence_tier]}
              >
                {TIER_LABEL[cluster.confidence_tier]}
              </Badge>
            )}
            {(cluster?.signals ?? []).map((s) => (
              <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                {SIGNAL_LABEL[s]}
              </Badge>
            ))}
          </DialogTitle>
        </DialogHeader>

        {isLoading
          ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )
          : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(members ?? []).map((m) => (
                <div key={m.ad_id} className="flex gap-3 rounded-md border p-2">
                  <div className="h-16 w-16 shrink-0 rounded bg-muted overflow-hidden flex items-center justify-center">
                    {m.thumbnail_url
                      ? <img src={m.thumbnail_url} alt={m.ad_name} className="h-full w-full object-cover" loading="lazy" />
                      : <ImageOff className="h-5 w-5 text-muted-foreground/50" />}
                  </div>
                  <div className="min-w-0 text-xs">
                    <div className="font-medium truncate" title={m.ad_name}>{m.ad_name}</div>
                    <div className="text-muted-foreground mt-1">
                      Spend {fmtMoney(m.spend)} · ROAS {m.roas?.toFixed(2)} · CTR {(m.ctr * 100).toFixed(2)}%
                    </div>
                    <div className="text-muted-foreground/70 truncate mt-0.5">
                      {[m.theme, m.hook, m.product].filter(Boolean).join(" · ") || "—"}
                    </div>
                    <div className="mt-1">
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 font-normal"
                      >
                        {m.analysis_status === "done" ? "Analyzed" : "Not analyzed"}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
              {(members ?? []).length === 0 && (
                <div className="text-sm text-muted-foreground py-6 col-span-full text-center">
                  No members found.
                </div>
              )}
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EntityReportPage() {
  const { selectedAccountId } = useAccountContext();
  const { isBuilder } = useAuth();
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [openCluster, setOpenCluster] = useState<EntityCluster | null>(null);

  // Builder-view rollout: available for the builder role on ANY account (the
  // account no longer gates). Non-builder roles see the gate below.
  const gated = !isBuilder;

  const { data, isLoading, error } = useEntityReport(gated ? undefined : selectedAccountId ?? undefined);

  const clusters = useMemo(() => {
    const rows = data?.clusters ?? [];
    const filtered = tierFilter === "all" ? rows : rows.filter((c) => c.confidence_tier === tierFilter);
    // RPC already sorts by spend DESC; re-sort defensively after filtering.
    return [...filtered].sort((a, b) => b.total_spend - a.total_spend);
  }, [data, tierFilter]);

  if (gated) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Entity Report"
          description="Semantic-similarity creative clustering"
          badge={<Badge variant="outline">Builder preview</Badge>}
        />
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            The Entity Report is available to the builder role. Switch to a builder
            account to view it.
          </CardContent>
        </Card>
      </div>
    );
  }

  const headline = data?.headline;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Entity Report"
        description="How many distinct creative entities Meta likely sees in this account"
        badge={<Badge variant="outline">Builder preview</Badge>}
      />

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load the entity report."}
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && headline && (
        <>
          {/* Headline strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <HeadlineStat
              label="Effective entities"
              value={headline.effective_entities.toFixed(1)}
              hint="Spend-weighted diversity"
            />
            <HeadlineStat label="Distinct entities" value={String(headline.distinct_entities)} />
            <HeadlineStat label="Clustered creatives" value={String(headline.clustered_creatives)} />
            <HeadlineStat
              label="Analysis coverage"
              value={`${headline.analysis_coverage_pct ?? 0}%`}
              hint={`${headline.analyzed_creatives ?? 0}/${headline.total_creatives} analyzed`}
            />
            <HeadlineStat
              label="Embedding coverage"
              value={`${headline.coverage_pct}%`}
              hint={`${headline.embedded_creatives}/${headline.total_creatives} embedded`}
            />
          </div>

          {/* Coverage caveat — keyed on ANALYSIS coverage (US-007), not just the
              older ai_visual_notes embedding coverage. */}
          {(headline.analysis_coverage_pct ?? 0) < 100 && (
            <div className="text-xs text-muted-foreground border-l-2 border-muted pl-3">
              Only {headline.analysis_coverage_pct ?? 0}% of creatives
              ({headline.analyzed_creatives ?? 0}/{headline.total_creatives}) have been
              analyzed (script + visual) so far. Entities still form from the exact-asset
              anchor and any available embeddings — confidence tiers and per-entity
              coverage strengthen as the analysis pipeline drains the account.
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Confidence</span>
            <Select value={tierFilter} onValueChange={(v) => setTierFilter(v as TierFilter)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tiers</SelectItem>
                <SelectItem value="exact">Exact match</SelectItem>
                <SelectItem value="corroborated">Corroborated</SelectItem>
                <SelectItem value="probable">Probable</SelectItem>
                <SelectItem value="visual_only">Visual only</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-auto">
              Sorted by spend · {clusters.length} {clusters.length === 1 ? "entity" : "entities"}
            </span>
          </div>

          {/* Cluster grid */}
          {clusters.length === 0
            ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  <Layers className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
                  No entities for this filter. Run the embedding + clustering jobs for
                  this account, or widen the confidence filter.
                </CardContent>
              </Card>
            )
            : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {clusters.map((c) => (
                  <ClusterCard key={c.id} cluster={c} onOpen={() => setOpenCluster(c)} />
                ))}
              </div>
            )}
        </>
      )}

      <ClusterMembersDialog
        accountId={selectedAccountId!}
        cluster={openCluster}
        onClose={() => setOpenCluster(null)}
      />
    </div>
  );
}
