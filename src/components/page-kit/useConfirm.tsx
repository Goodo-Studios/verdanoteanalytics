import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ConfirmDialog, type ConfirmCopy } from "./ConfirmAction";

/**
 * A promise version of `window.confirm`:
 *
 *   const { confirm, dialog } = useConfirm();
 *   if (!(await confirm({ title, description, actionLabel }))) return;
 *   ...
 *   return <>{page}{dialog}</>;
 *
 * Render `dialog` once in the page. `confirm` resolves true on the action button and
 * false on Cancel, Escape or a click outside.
 */
export function useConfirm(): { confirm: (copy: ConfirmCopy) => Promise<boolean>; dialog: ReactNode } {
  const [copy, setCopy] = useState<ConfirmCopy | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setCopy(null);
  }, []);

  const confirm = useCallback((next: ConfirmCopy) => {
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setCopy(next);
    });
  }, []);

  const dialog = (
    <ConfirmDialog
      open={copy !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
      onConfirm={() => settle(true)}
      title={copy?.title ?? ""}
      description={copy?.description ?? ""}
      actionLabel={copy?.actionLabel ?? "Confirm"}
      tone={copy?.tone}
    />
  );

  return { confirm, dialog };
}
