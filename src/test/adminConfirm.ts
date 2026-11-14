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

/** Presses Cancel and waits for the dialog to close. */
export async function declineConfirm(): Promise<void> {
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
}
