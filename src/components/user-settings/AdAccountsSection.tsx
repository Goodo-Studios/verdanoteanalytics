import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, RefreshCw, Loader2, Building2, Pencil, Image } from "lucide-react";

interface AdAccountsSectionProps {
  accounts: any[];
  syncPending: boolean;
  onSyncAll: () => void;
  onRefreshAllMedia: () => void;
  refreshAllMediaPending: boolean;
  onOpenAddModal: () => void;
  onRename: (account: { id: string; name: string }) => void;
  onDelete: (id: string) => void;
}

export function AdAccountsSection({ accounts, syncPending, onSyncAll, onRefreshAllMedia, refreshAllMediaPending, onOpenAddModal, onRename, onDelete }: AdAccountsSectionProps) {
  return (
    <section className="glass-panel p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-[20px] text-forest">Ad Accounts</h2>
          <p className="font-body text-[13px] text-slate mt-0.5">Add or remove Meta ad accounts.</p>
        </div>
        <div className="flex gap-2">
          {accounts?.length > 0 && (
            <>
              <Button size="sm" variant="secondary" onClick={onSyncAll} disabled={syncPending}>
                {syncPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                Sync All
              </Button>
              <Button size="sm" variant="secondary" onClick={onRefreshAllMedia} disabled={refreshAllMediaPending}>
                {refreshAllMediaPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Image className="h-3.5 w-3.5 mr-1.5" />}
                Refresh All Media
              </Button>
            </>
          )}
          <Button size="sm" className="bg-verdant text-white hover:bg-verdant/90" onClick={onOpenAddModal}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />Add
          </Button>
        </div>
      </div>

      {!accounts?.length ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
            <Building2 className="h-5 w-5 text-sage" />
          </div>
          <p className="font-body text-[13px] text-slate">Click 'Add' to connect an ad account from your Meta Business.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border-light">
          <Table>
            <TableHeader>
              <TableRow className="bg-cream-dark">
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Account</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Creatives</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border-light">
              {accounts.map((acc: any) => (
                <TableRow key={acc.id} className="border-0">
                  <TableCell className="py-3.5">
                    <div className="font-body text-[14px] font-medium text-charcoal">{acc.name}</div>
                    <div className="font-data text-[11px] text-sage tracking-wide">{acc.id}</div>
                  </TableCell>
                  <TableCell className="py-3.5">
                    <span className="font-data text-[17px] font-semibold text-charcoal">{acc.creative_count}</span>
                  </TableCell>
                  <TableCell className="text-right py-3.5">
                    <Button size="sm" variant="ghost" className="text-sage hover:text-forest" onClick={() => onRename({ id: acc.id, name: acc.name })} title="Rename">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-sage hover:text-red-600" onClick={() => onDelete(acc.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
