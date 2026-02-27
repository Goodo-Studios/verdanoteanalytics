import { useState, useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAuth } from "@/contexts/AuthContext";
import { useBriefs, useBriefTemplates, useCreateBrief, useUpdateBrief, useDeleteBrief, type Brief } from "@/hooks/useBriefsApi";
import { useAccounts } from "@/hooks/useAccountsApi";
import { BriefEditorModal } from "@/components/briefs/BriefEditorModal";
import { Plus, Search, Trash2, ExternalLink, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STATUS_PIPELINE = ["draft", "sent", "in_production", "complete"] as const;
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  in_production: "In Production",
  complete: "Complete",
};
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-50 text-blue-700",
  in_production: "bg-amber-50 text-amber-700",
  complete: "bg-emerald-50 text-emerald-700",
};

const BriefsPage = () => {
  const { selectedAccountId } = useAccountContext();
  const { user } = useAuth();
  const { data: briefs = [], isLoading } = useBriefs(selectedAccountId);
  const { data: accounts = [] } = useAccounts();
  const { data: templates = [] } = useBriefTemplates();
  const createBrief = useCreateBrief();
  const updateBrief = useUpdateBrief();
  const deleteBrief = useDeleteBrief();

  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "kanban">("kanban");
  const [editorBrief, setEditorBrief] = useState<Brief | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!search) return briefs;
    const q = search.toLowerCase();
    return briefs.filter((b) =>
      b.name.toLowerCase().includes(q) ||
      (b.assignee_name || "").toLowerCase().includes(q),
    );
  }, [briefs, search]);

  const accountName = (id: string) => accounts.find((a: any) => a.id === id)?.name || id;

  const handleNew = (templateId?: string, refAdIds?: string[]) => {
    const acctId = selectedAccountId === "all" ? accounts[0]?.id : selectedAccountId;
    if (!acctId) {
      toast.error("Select an account first");
      return;
    }
    const template = templateId ? templates.find((t) => t.id === templateId) : null;
    const newBrief: Partial<Brief> = {
      account_id: acctId,
      name: template ? `${template.name} Brief` : "New Brief",
      status: "draft",
      template_id: templateId || null,
      reference_ad_ids: refAdIds || [],
      content: template?.sections
        ? Object.fromEntries((template.sections as any[]).map((s: any) => [s.key, ""]))
        : {
            concept_name: "",
            objective: "",
            reference_ads: refAdIds || [],
            hook: "",
            key_message: "",
            cta: "",
            format_specs: "",
            dos: "",
            donts: "",
          },
      created_by: user?.id,
    };
    createBrief.mutate(newBrief as any, {
      onSuccess: (created) => {
        setEditorBrief(created);
        setEditorOpen(true);
      },
    });
  };

  const handleStatusChange = (briefId: string, newStatus: string) => {
    updateBrief.mutate({ id: briefId, status: newStatus } as any);
  };

  const copyShareLink = (token: string) => {
    const url = `${window.location.origin}/briefs/share/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Share link copied");
  };

  return (
    <AppLayout>
      <PageHeader title="Briefs" description="Create and manage creative briefs for editors and creators." />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search briefs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 font-body text-[13px]"
          />
        </div>
        <div className="flex gap-1 border border-border-light rounded-md p-0.5">
          <button
            onClick={() => setView("kanban")}
            className={cn("font-body text-[11px] px-2.5 py-1 rounded transition-colors", view === "kanban" ? "bg-verdant text-white" : "text-muted-foreground hover:text-foreground")}
          >
            Pipeline
          </button>
          <button
            onClick={() => setView("table")}
            className={cn("font-body text-[11px] px-2.5 py-1 rounded transition-colors", view === "table" ? "bg-verdant text-white" : "text-muted-foreground hover:text-foreground")}
          >
            Table
          </button>
        </div>
        <Button size="sm" className="bg-verdant hover:bg-verdant/90 text-white font-body text-[12px] gap-1.5" onClick={() => handleNew()}>
          <Plus className="h-3.5 w-3.5" /> New Brief
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground font-body text-[13px]">Loading briefs…</div>
      ) : view === "kanban" ? (
        /* ── Kanban Pipeline ──────────────── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STATUS_PIPELINE.map((status) => {
            const items = filtered.filter((b) => b.status === status);
            return (
              <div key={status} className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <h3 className="font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {STATUS_LABELS[status]}
                  </h3>
                  <span className="font-data text-[10px] text-muted-foreground bg-muted rounded-full px-1.5">{items.length}</span>
                </div>
                <div className="space-y-2 min-h-[80px]">
                  {items.map((brief) => (
                    <button
                      key={brief.id}
                      onClick={() => { setEditorBrief(brief); setEditorOpen(true); }}
                      className="w-full text-left p-3 rounded-lg border border-border-light bg-white hover:shadow-card transition-shadow space-y-2"
                    >
                      <p className="font-body text-[13px] font-semibold text-forest truncate">{brief.name}</p>
                      <p className="font-body text-[11px] text-muted-foreground">{accountName(brief.account_id)}</p>
                      <div className="flex items-center justify-between">
                        {brief.assignee_name && (
                          <span className="font-body text-[11px] text-slate">{brief.assignee_name}</span>
                        )}
                        {brief.due_date && (
                          <span className="font-data text-[10px] text-muted-foreground">{brief.due_date}</span>
                        )}
                      </div>
                    </button>
                  ))}
                  {items.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border-light p-4 text-center">
                      <p className="font-body text-[11px] text-muted-foreground">No briefs</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Table View ───────────────────── */
        <div className="border border-border-light rounded-lg overflow-hidden bg-white">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border-light bg-muted/30">
                {["Name", "Account", "Assignee", "Due Date", "Status", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((brief) => (
                <tr
                  key={brief.id}
                  className="border-b border-border-light last:border-0 hover:bg-muted/20 cursor-pointer"
                  onClick={() => { setEditorBrief(brief); setEditorOpen(true); }}
                >
                  <td className="px-4 py-3 font-body text-[13px] font-medium text-charcoal">{brief.name}</td>
                  <td className="px-4 py-3 font-body text-[12px] text-slate">{accountName(brief.account_id)}</td>
                  <td className="px-4 py-3 font-body text-[12px] text-slate">{brief.assignee_name || "—"}</td>
                  <td className="px-4 py-3 font-data text-[12px] text-slate">{brief.due_date || "—"}</td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className={cn("font-label text-[9px] uppercase", STATUS_COLORS[brief.status])}>
                      {STATUS_LABELS[brief.status] || brief.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => copyShareLink(brief.share_token)} className="p-1 rounded hover:bg-muted" title="Copy share link">
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      <button onClick={() => deleteBrief.mutate(brief.id)} className="p-1 rounded hover:bg-destructive/10" title="Delete">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center font-body text-[13px] text-muted-foreground">
                    No briefs yet. Create your first brief to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Editor modal */}
      <BriefEditorModal
        brief={editorBrief}
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditorBrief(null); }}
        onStatusChange={handleStatusChange}
        onCopyShareLink={copyShareLink}
      />
    </AppLayout>
  );
};

export default BriefsPage;
