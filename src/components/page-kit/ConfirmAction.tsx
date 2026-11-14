import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ConfirmCopy {
  title: string;
  description: string;
  /** The button that goes ahead, for example "Delete". */
  actionLabel: string;
  /** `danger` (default) paints the action red. Use `default` for a plain "are you sure". */
  tone?: "danger" | "default";
}

interface ConfirmDialogProps extends ConfirmCopy {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/** The confirm dialog every page uses in place of `window.confirm`. */
export function ConfirmDialog({ open, onOpenChange, onConfirm, title, description, actionLabel, tone = "danger" }: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className={cn(tone === "danger" && buttonVariants({ variant: "destructive" }))} onClick={onConfirm}>
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
