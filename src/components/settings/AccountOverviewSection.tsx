import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, RefreshCw, Clock, Upload, Pencil, Image, Sparkles } from "lucide-react";

interface AccountOverviewSectionProps {
  account: any;
  onRename: () => void;
  onSync: () => void;
  syncPending: boolean;
  onUploadCsv: () => void;
  onToggle: (checked: boolean) => void;
  onRefreshMedia?: () => void;
  refreshMediaPending?: boolean;
  onAIBrief?: () => void;
  showAIBrief?: boolean;
}

export function AccountOverviewSection({
  account, onRename, onSync, syncPending, onUploadCsv, onToggle, onRefreshMedia, refreshMediaPending, onAIBrief, showAIBrief,
}: AccountOverviewSectionProps) {
  const formatDate = (d: string | null) => {
    if (!d) return "Never";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <section className="glass-panel p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-[20px] text-forest">Account Overview</h2>
          <p className="font-data text-[12px] text-sage tracking-wide">{account.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={onRename} title="Rename">
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Edit
          </Button>
          <Button size="sm" variant="secondary" onClick={onSync} disabled={syncPending}>
            {syncPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            Sync
          </Button>
          <Button size="sm" variant="secondary" onClick={onUploadCsv}>
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Upload CSV
          </Button>
          {onRefreshMedia && (
            <Button size="sm" variant="secondary" onClick={onRefreshMedia} disabled={refreshMediaPending}>
              {refreshMediaPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Image className="h-3.5 w-3.5 mr-1.5" />}
              Refresh Media
            </Button>
          )}
          {showAIBrief && onAIBrief && (
            <Button size="sm" variant="secondary" onClick={onAIBrief}>
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              AI Brief
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-label text-[11px] uppercase tracking-wide text-slate">Active</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-wide text-slate">Creatives</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-wide text-slate">Last Synced</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>
                <Switch checked={account.is_active} onCheckedChange={onToggle} />
              </TableCell>
              <TableCell>
                <span className="font-data text-[16px] font-semibold text-charcoal">{account.creative_count}</span>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3 text-sage" />
                  <span className="font-data text-[13px] text-slate">{formatDate(account.last_synced_at)}</span>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
