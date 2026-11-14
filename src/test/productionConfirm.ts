import { fireEvent, screen, waitFor, within } from "@testing-library/react";

/** Presses the action button (by name) of the open confirm dialog, or Cancel. */
export async function answerConfirm(action: string | RegExp): Promise<void> {
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: action }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
}
