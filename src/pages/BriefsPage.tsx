import { useState, useMemo } from "react";
import { ConfirmDialog, DataTable, EmptyState, FilterBar, LoadingState, PageHeader, PageShell, type DataColumn } from "@/components/page-kit";
import { Button } from "@/components/ui/button";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAuth } from "@/contexts/AuthContext";
import { useBriefs, useBriefTemplates, useCreateBrief, useDeleteBrief, type Brief } from "@/hooks/useBriefsApi";
import { useAccounts } from "@/hooks/useAccountsApi";
import { BriefEditorModal } from "@/components/briefs/BriefEditorModal";
import { Plus, Trash2, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const BriefsPage = () => {
  const { selectedAccountId } = useAccountContext();
  const { user } = useAuth();
  const { data: briefs = [], isLoading } = useBriefs(selectedAccountId ?? undefined);
  const { data: accounts = [] } = useAccounts();
  const { data: templates = [] } = useBriefTemplates();
  const createBrief = useCreateBrief();
  const deleteBrief = useDeleteBrief();

  const [search, setSearch] = useState("");
  const [editorBrief, setEditorBrief] = useState<Brief | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorIsNew, setEditorIsNew] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Brief | null>(null);

  const filtered = useMemo(() => {
    if (!search) return briefs;
    const q = search.toLowerCase();
    return briefs.filter((b) => b.name.toLowerCase().includes(q));
  }, [briefs, search]);

  const accountName = (id: string) => accounts.find((a: any) => a.id === id)?.name || id;

  const handleNew = (templateId?: string, refAdIds?: string[]) => {
    const acctId = selectedAccountId === "all" ? accounts[0]?.id : selectedAccountId;
    if (!acctId) {
      toast.error("Pick a client first");
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
        setEditorIsNew(true);
        setEditorOpen(true);
      },
    });
  };

  const copyShareLink = (token: string) => {
    const url = `${window.location.origin}/briefs/share/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Share link copied");
  };

  const columns: DataColumn<Brief>[] = [
    { key: "name", header: "Name", cell: (b) => <span className="font-medium text-charcoal">{b.name}</span>, sortValue: (b) => b.name },
    { key: "account", header: "Account", cell: (b) => <span className="text-slate">{accountName(b.account_id)}</span>, sortValue: (b) => accountName(b.account_id) },
    {
      key: "actions",
      header: "Actions",
      srOnlyHeader: true,
      cell: (b) => (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => b.share_token && copyShareLink(b.share_token)}
            title="Copy share link"
            aria-label={`Copy share link for ${b.name}`}
            disabled={!b.share_token}
          >
            <Copy className={cn("h-3.5 w-3.5", b.share_token ? "text-muted-foreground" : "text-muted-foreground/30")} />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPendingDelete(b)} title="Delete" aria-label={`Delete ${b.name}`}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Briefs"
        description="Create a brief from the data, share it or push it to ClickUp."
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => handleNew()} disabled={createBrief.isPending}>
            <Plus className="h-3.5 w-3.5" /> New Brief
          </Button>
        }
      />

      <FilterBar search={{ value: search, onChange: setSearch, label: "Search briefs", placeholder: "Search briefs" }} />

      {isLoading ? (
        <LoadingState label="Loading briefs" />
      ) : (
        <DataTable
          label="Briefs"
          columns={columns}
          rows={filtered}
          rowKey={(b) => b.id}
          onRowClick={(b) => { setEditorBrief(b); setEditorIsNew(false); setEditorOpen(true); }}
          empty={<EmptyState title="No briefs yet." description="Create your first brief to get started." className="border-0" />}
        />
      )}

      {/* Editor modal */}
      <BriefEditorModal
        brief={editorBrief}
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditorBrief(null); setEditorIsNew(false); }}
        onCopyShareLink={copyShareLink}
        isNew={editorIsNew}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Delete this brief?"
        description={`"${pendingDelete?.name ?? ""}" will be deleted for everyone, including anyone with its share link. This can't be undone.`}
        actionLabel="Delete brief"
        onConfirm={() => {
          if (pendingDelete) deleteBrief.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </PageShell>
  );
};

export default BriefsPage;
