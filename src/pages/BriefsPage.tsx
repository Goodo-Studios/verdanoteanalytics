import { useState, useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAuth } from "@/contexts/AuthContext";
import { useBriefs, useBriefTemplates, useCreateBrief, useDeleteBrief, type Brief } from "@/hooks/useBriefsApi";
import { useAccounts } from "@/hooks/useAccountsApi";
import { BriefEditorModal } from "@/components/briefs/BriefEditorModal";
import { Plus, Search, Trash2, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const BriefsPage = () => {
  const { selectedAccountId } = useAccountContext();
  const { user } = useAuth();
  const { data: briefs = [], isLoading } = useBriefs(selectedAccountId);
  const { data: accounts = [] } = useAccounts();
  const { data: templates = [] } = useBriefTemplates();
  const createBrief = useCreateBrief();
  const deleteBrief = useDeleteBrief();

  const [search, setSearch] = useState("");
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

  const copyShareLink = (token: string) => {
    const url = `${window.location.origin}/briefs/share/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Share link copied");
  };

  return (
    <>
      <PageHeader title="Briefs" description="Create a brief from the data and push it to Coda." />

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
        <Button size="sm" className="bg-verdant hover:bg-verdant/90 text-white font-body text-[12px] gap-1.5" onClick={() => handleNew()}>
          <Plus className="h-3.5 w-3.5" /> New Brief
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground font-body text-[13px]">Loading briefs…</div>
      ) : (
        <div className="border border-border-light rounded-lg overflow-hidden bg-card">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border-light bg-muted/30">
                {["Name", "Account", "Assignee", "Due Date", ""].map((h) => (
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
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => brief.share_token && copyShareLink(brief.share_token)} className="p-1 rounded hover:bg-muted" title="Copy share link" disabled={!brief.share_token}>
                        <Copy className={cn("h-3.5 w-3.5", brief.share_token ? "text-muted-foreground" : "text-muted-foreground/30")} />
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
                  <td colSpan={5} className="px-4 py-8 text-center font-body text-[13px] text-muted-foreground">
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
        onCopyShareLink={copyShareLink}
      />
    </>
  );
};

export default BriefsPage;
