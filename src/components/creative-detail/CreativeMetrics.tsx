import { fmtMetric } from "@/lib/formatters";

interface CreativeMetricsProps {
  creative: any;
}

export function CreativeMetrics({ creative }: CreativeMetricsProps) {
  const fmtVal = (v: number | null, prefix = "", suffix = "") => {
    if (v === null || v === undefined || v === 0) return "—";
    return fmtMetric(v, prefix, suffix, 2);
  };

  const fmtInt = (v: number | null) => {
    if (v === null || v === undefined || v === 0) return "—";
    return fmtMetric(v, "", "", 0);
  };

  const cpmr = (creative.cpm && creative.frequency) ? creative.cpm * creative.frequency : null;

  const sections = [
    {
      title: "Spend & Efficiency",
      cols: 6,
      metrics: [
        { label: "Spend", value: fmtVal(creative.spend, "$") },
        { label: "CPA", value: fmtVal(creative.cpa, "$") },
        { label: "CPM", value: fmtVal(creative.cpm, "$") },
        { label: "CPC", value: fmtVal(creative.cpc, "$") },
        { label: "Frequency", value: fmtVal(creative.frequency) },
        { label: "CPMr", value: fmtVal(cpmr, "$") },
      ],
    },
    {
      title: "Performance & Commerce",
      cols: 5,
      metrics: [
        { label: "ROAS", value: fmtVal(creative.roas, "", "x") },
        { label: "Purchases", value: fmtInt(creative.purchases) },
        { label: "Purchase Value", value: fmtVal(creative.purchase_value, "$") },
        { label: "Adds to Cart", value: fmtInt(creative.adds_to_cart) },
        { label: "Cost / ATC", value: fmtVal(creative.cost_per_add_to_cart, "$") },
      ],
    },
    {
      title: "Engagement",
      cols: 4,
      metrics: [
        { label: "Unique CTR", value: fmtVal(creative.ctr, "", "%") },
        { label: "Hook Rate", value: fmtVal(creative.thumb_stop_rate, "", "%") },
        { label: "Hold Rate", value: fmtVal(creative.hold_rate, "", "%") },
        { label: "Avg Play Time", value: fmtVal(creative.video_avg_play_time, "", "s") },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-slate mb-2 pb-1.5 border-b border-border-light">{section.title}</p>
          <div className={`grid gap-px bg-border-light`} style={{ gridTemplateColumns: `repeat(${section.cols}, minmax(0, 1fr))` }}>
            {section.metrics.map((m) => (
              <div key={m.label} className="bg-background py-3 px-2.5 text-center">
                <div className="font-label text-[9px] uppercase tracking-[0.06em] text-sage">{m.label}</div>
                <div className="font-data text-[17px] font-semibold text-charcoal mt-0.5">{m.value}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
