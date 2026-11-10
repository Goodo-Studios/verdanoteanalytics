import { cloneElement, useState } from "react";
import type { MouseEvent, ReactElement } from "react";
import { ConfirmDialog, type ConfirmCopy } from "./ConfirmAction";

interface ConfirmTriggerProps extends ConfirmCopy {
  /** The button that starts the action. It must accept `onClick`. */
  children: ReactElement<{ onClick?: (e: MouseEvent) => void }>;
  onConfirm: () => void;
}

/**
 * Wraps a button so that clicking it opens a confirm dialog first. `onConfirm` runs
 * only when the person presses the action button.
 */
export function ConfirmTrigger({ children, onConfirm, ...copy }: ConfirmTriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {cloneElement(children, { onClick: () => setOpen(true) })}
      <ConfirmDialog {...copy} open={open} onOpenChange={setOpen} onConfirm={onConfirm} />
    </>
  );
}
