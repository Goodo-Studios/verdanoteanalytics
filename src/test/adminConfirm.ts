// Helpers for tests of pages that ask "are you sure?" with the kit's confirm dialog
// (useConfirm / ConfirmTrigger) instead of window.confirm.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";

/** Waits for the confirm dialog and returns its title and description text. */
export async function confirmDialogText(): Promise<string> {
  const dialog = await screen.findByRole("alertdialog");
  return dialog.textContent ?? "";
}

/** Presses the action button (the one that is not Cancel) and waits for the dialog to close. */
export async function acceptConfirm(): Promise<void> {
  const dialog = await screen.findByRole("alertdialog");
  const action = within(dialog).getAllByRole("button").find((b) => b.textContent !== "Cancel");
  if (!action) throw new Error("The confirm dialog has no action button.");
  fireEvent.click(action);
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
}

/**
 * Presses Cancel and waits for the dialog to close. Pass the button that opened it when the test
 * presses it again: pages keep that button disabled until the declined action has finished, and a
 * click on a disabled button does nothing, so the test would wait for a dialog that never opens.
 */
export async function declineConfirm(trigger?: HTMLElement): Promise<void> {
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  if (trigger) await waitFor(() => expect(trigger).toBeEnabled());
}
