import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CustomCalloutSectionProps {
  config: Record<string, any>;
  report: any;
  isEditing?: boolean;
  onConfigChange?: (config: Record<string, any>) => void;
}

const ICON_OPTIONS = ["🏆", "🔥", "📈", "💰", "⚡", "🎯", "🚀", "⭐"];

export function CustomCalloutSection({ config, isEditing, onConfigChange }: CustomCalloutSectionProps) {
  const icon = config.icon || "🏆";
  const stat = config.stat || "";
  const label = config.label || "";

  if (isEditing) {
    return (
      <div className="space-y-3">
        <div className="p-3 rounded-[6px] bg-muted/50 border border-border-light space-y-3">
          <div className="space-y-1">
            <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Icon</Label>
            <div className="flex gap-1.5">
              {ICON_OPTIONS.map((ic) => (
                <button
                  key={ic}
                  onClick={() => onConfigChange?.({ ...config, icon: ic })}
                  className={`text-lg p-1 rounded-[4px] ${icon === ic ? "bg-primary/20 ring-1 ring-primary" : "hover:bg-muted"}`}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Stat</Label>
              <Input
                value={stat}
                onChange={(e) => onConfigChange?.({ ...config, stat: e.target.value })}
                placeholder="e.g. 23.3x"
                className="font-data text-[17px] h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Label</Label>
              <Input
                value={label}
                onChange={(e) => onConfigChange?.({ ...config, label: e.target.value })}
                placeholder="e.g. Best ROAS — Chelsea Field Trip UGC"
                className="font-body text-[14px] h-8"
              />
            </div>
          </div>
        </div>
        {/* Preview */}
        <CalloutDisplay icon={icon} stat={stat} label={label} />
      </div>
    );
  }

  if (!stat && !label) return null;
  return <CalloutDisplay icon={icon} stat={stat} label={label} />;
}

function CalloutDisplay({ icon, stat, label }: { icon: string; stat: string; label: string }) {
  return (
    <div className="flex items-center gap-4 rounded-card border-2 border-primary/20 bg-primary/5 px-5 py-4">
      <span className="text-2xl">{icon}</span>
      <div>
        <span className="font-data text-[22px] font-bold text-foreground">{stat || "—"}</span>
        {label && <p className="font-body text-[14px] text-muted-foreground mt-0.5">{label}</p>}
      </div>
    </div>
  );
}
