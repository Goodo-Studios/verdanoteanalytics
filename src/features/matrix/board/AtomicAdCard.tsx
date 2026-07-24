// US-008: the atomic ad — the leaf of the drill-down. Opened when a strategist
// clicks an inner hook × body cell. Shows the ad's Theme/Persona, creative type,
// hook, body, spend, objective metric, delivery state, and a thumbnail/preview.
//
// Theme/Persona (angleLabel) and creative type come from the OUTER cell (they
// are constant across the inner grid); hook / body / spend / metric / state /
// media are per-ad. The objective metric follows the account's optimization
// goal (getObjectiveConfig) so PURCHASE accounts read ROAS/CPA and
// SESSION_CONVERSION accounts read Sessions / Cost per session.

import { getObjectiveConfig, type MetricConfig } from "@/lib/objectiveConfig";
import type { MatrixAtomicAd } from "./api";
import { fmtMoney, tagLabel } from "./matrixView";

export interface AtomicAdCardProps {
  ad: MatrixAtomicAd;
  /** Outer-cell Theme/Persona label. */
  angleLabel: string | null;
  /** Outer-cell creative type (null ⇒ untagged). */
  creativeType: string | null;
  /** Account optimization goal → which objective metric(s) to surface. */
  optimizationGoal: string | null | undefined;
}

function formatMetricValue(value: number, format: MetricConfig["format"]): string {
  switch (format) {
    case "currency":
      return fmtMoney(value);
    case "multiplier":
      return `${(value ?? 0).toFixed(2)}x`;
    case "percent":
      return `${(value ?? 0).toFixed(2)}%`;
    case "integer":
      return String(Math.round(value ?? 0));
    default:
      return String(value ?? 0);
  }
}

/** A live/inactive pill from the Meta delivery state. */
function StateBadge({ status }: { status: string | null }) {
  const isLive = (status ?? "").toUpperCase() === "ACTIVE";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-label text-[10px] uppercase tracking-wide ${
        isLive ? "bg-verdant/15 text-verdant" : "bg-muted text-muted-foreground"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-verdant" : "bg-muted-foreground/60"}`}
        aria-hidden
      />
      {status && status.trim() ? status : "Unknown"}
    </span>
  );
}

export function AtomicAdCard({ ad, angleLabel, creativeType, optimizationGoal }: AtomicAdCardProps) {
  const objective = getObjectiveConfig(optimizationGoal);
  const metrics = objective.primaryMetrics;

  return (
    <div
      className="glass-panel flex gap-3 p-3 animate-in fade-in slide-in-from-bottom-1 duration-200"
      data-testid="atomic-ad-card"
    >
      {/* Thumbnail / preview */}
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
        {ad.thumbnail_url ? (
          <img
            src={ad.thumbnail_url}
            alt={ad.ad_name ?? "Ad thumbnail"}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : ad.preview_url || ad.video_url ? (
          <a
            href={ad.preview_url ?? ad.video_url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-full w-full items-center justify-center font-label text-[10px] uppercase tracking-wide text-sage hover:text-forest"
          >
            Preview
          </a>
        ) : (
          <div className="flex h-full w-full items-center justify-center font-label text-[10px] uppercase tracking-wide text-muted-foreground">
            No media
          </div>
        )}
      </div>

      {/* Details */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="truncate font-body text-[13px] font-medium text-charcoal">
            {ad.ad_name ?? "Untitled ad"}
          </span>
          <StateBadge status={ad.ad_status} />
        </div>

        {/* Dimension chips: Theme/Persona × type, hook, body */}
        <div className="mt-1 flex flex-wrap gap-1.5 font-body text-[11px]">
          <span className="rounded bg-sage-light/50 px-1.5 py-0.5 text-forest">
            {tagLabel(angleLabel)} · {tagLabel(creativeType)}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 ${
              ad.is_untagged_hook
                ? "bg-muted text-muted-foreground italic"
                : "bg-accent/50 text-charcoal"
            }`}
          >
            Hook: {tagLabel(ad.hook)}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 ${
              ad.is_untagged_body
                ? "bg-muted text-muted-foreground italic"
                : "bg-accent/50 text-charcoal"
            }`}
          >
            Body: {tagLabel(ad.body)}
          </span>
        </div>

        {/* Spend + objective metrics */}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-body text-[12px]">
          <span>
            <span className="text-muted-foreground">Spend</span>{" "}
            <span className="font-medium text-charcoal">{fmtMoney(ad.total_spend)}</span>
          </span>
          {metrics.map((m) => (
            <span key={m.key}>
              <span className="text-muted-foreground">{m.label}</span>{" "}
              <span className="font-medium text-charcoal">
                {formatMetricValue((ad as unknown as Record<string, number>)[m.key] ?? 0, m.format)}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
