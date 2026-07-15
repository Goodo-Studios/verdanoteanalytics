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
  useEntityClusterMembers,
  useEntityReport,
} from "@/hooks/useEntityReport";

// Builder-account-first rollout: the Entity Report ships gated to the Goodo
// builder account only (see roadmap §"Rollout sequencing"). Account ids are
// stored with the Meta `act_` prefix.
const BUILDER_ACCOUNT_ID = "act_782159176742035";

type TierFilter = "all" | ConfidenceTier;

const TIER_LABEL: Record<ConfidenceTier, string> = {
  corroborated: "Corroborated",
  probable: "Probable",
  visual_only: "Visual only",
};

const TIER_VARIANT: Record<ConfidenceTier, "default" | "secondary" | "outline"> = {
  corroborated: "default",
  probable: "secondary",
  visual_only: "outline",
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
          <Badge variant={TIER_VARIANT[cluster.confidence_tier]}>
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
              <Badge variant={TIER_VARIANT[cluster.confidence_tier]}>
                {TIER_LABEL[cluster.confidence_tier]}
              </Badge>
            )}
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

  // Builder-account-first gate: only the builder role, only the Goodo account.
  const gated = !isBuilder || selectedAccountId !== BUILDER_ACCOUNT_ID;

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
            The Entity Report is in builder-account-first rollout. Select the Goodo
            builder account to view it.
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <HeadlineStat
              label="Effective entities"
              value={headline.effective_entities.toFixed(1)}
              hint="Spend-weighted diversity"
            />
            <HeadlineStat label="Distinct entities" value={String(headline.distinct_entities)} />
            <HeadlineStat label="Clustered creatives" value={String(headline.clustered_creatives)} />
            <HeadlineStat
              label="Embedding coverage"
              value={`${headline.coverage_pct}%`}
              hint={`${headline.embedded_creatives}/${headline.total_creatives} creatives`}
            />
          </div>

          {/* Coverage caveat when text feature coverage is thin */}
          {headline.coverage_pct < 100 && (
            <div className="text-xs text-muted-foreground border-l-2 border-muted pl-3">
              {100 - headline.coverage_pct}% of creatives had no visual notes or tags to
              embed and were skipped (not silently dropped). Clusters reflect the
              embedded subset only.
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Confidence</span>
            <Select value={tierFilter} onValueChange={(v) => setTierFilter(v as TierFilter)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tiers</SelectItem>
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
