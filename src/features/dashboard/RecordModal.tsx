import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * A centered modal for opening one record (a creator or an actor) over its list. The list keeps its
 * place and filters underneath. The record's own page header is the visible title, so the dialog
 * title is for screen readers only.
 */
export function RecordModal({ open, label, onClose, children }: { open: boolean; label: string; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent data-testid="record-modal" aria-describedby={undefined} className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogTitle className="sr-only">{label}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** The detail pages' frame when they sit inside the modal: no page width cap, no back link. */
export function EmbeddedShell({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="space-y-4" {...rest}>
      {children}
    </div>
  );
}
