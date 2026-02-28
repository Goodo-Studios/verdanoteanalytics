import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { AccountSetupChecklist } from "./AccountSetupChecklist";

interface Props {
  open: boolean;
  onClose: () => void;
  account: any;
  onSwitchTab?: (tab: string) => void;
}

export function OnboardingChecklistModal({ open, onClose, account, onSwitchTab }: Props) {
  if (!account) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-[20px] text-forest">
            Welcome to {account.name}! 🚀
          </DialogTitle>
          <DialogDescription className="font-body text-[13px]">
            Complete these steps to get the most out of your account setup.
          </DialogDescription>
        </DialogHeader>
        <AccountSetupChecklist
          account={account}
          onSwitchTab={(tab) => { onSwitchTab?.(tab); onClose(); }}
          onAllComplete={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
