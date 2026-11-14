/**
 * The staff page kit (phase 3): shell, header, filter bar, table, status badge, empty,
 * loading and error states, confirm dialog and field helpers.
 */
import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import {
  ConfirmTrigger,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  PageHeader,
  PageShell,
  SelectField,
  StatusBadge,
  TextField,
  TextareaField,
  statusKeyOf,
  useConfirm,
  type DataColumn,
} from "@/components/page-kit";
import { fmtDate, fmtWhen } from "@/lib/formatters";

type Row = { id: string; name: string; due: string | null; n: number };
const ROWS: Row[] = [
  { id: "a", name: "Bravo", due: "2026-11-12", n: 2 },
  { id: "b", name: "Alpha", due: null, n: 10 },
  { id: "c", name: "Charlie", due: "2026-11-01", n: 1 },
];
const COLUMNS: DataColumn<Row>[] = [
  { key: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name },
  { key: "due", header: "Due", cell: (r) => fmtDate(r.due), sortValue: (r) => r.due },
  { key: "n", header: "Count", cell: (r) => r.n, sortValue: (r) => r.n, align: "right" },
  { key: "actions", header: "Actions", srOnlyHeader: true, cell: (r) => <button type="button" aria-label={`Edit ${r.name}`}>Edit</button> },
];
const names = () => screen.getAllByRole("row").slice(1).map((r) => within(r).queryAllByRole("cell")[0]?.textContent);

describe("PageShell and PageHeader", () => {
  it("uses one standard width and a wide mode", () => {
    const { rerender } = render(<PageShell data-testid="shell">x</PageShell>);
    expect(screen.getByTestId("shell").className).toContain("max-w-6xl");
    expect(screen.getByTestId("shell").getAttribute("data-page-shell")).toBe("standard");
    rerender(<PageShell wide data-testid="shell">x</PageShell>);
    expect(screen.getByTestId("shell").className).toContain("max-w-none");
    expect(screen.getByTestId("shell").className).not.toContain("p-6");
  });

  it("shows title, description and an action", () => {
    render(<PageHeader title="Crew" description="Who we book." actions={<button type="button">Add</button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Crew" })).toBeInTheDocument();
    expect(screen.getByText("Who we book.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });
});

describe("FilterBar and fields", () => {
  it("wires search and selects with labels", () => {
    const onSearch = vi.fn();
    const onRole = vi.fn();
    render(
      <FilterBar search={{ value: "", onChange: onSearch, label: "Search crew", placeholder: "Search crew" }}>
        <SelectField label="Role" hideLabel value="" onChange={(e) => onRole(e.target.value)} placeholder="Any role" options={[{ value: "PA", label: "PA" }]} />
      </FilterBar>,
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "Search crew" }), { target: { value: "rob" } });
    expect(onSearch).toHaveBeenCalledWith("rob");
    fireEvent.change(screen.getByRole("combobox", { name: "Role" }), { target: { value: "PA" } });
    expect(onRole).toHaveBeenCalledWith("PA");
    expect(screen.getByRole("option", { name: "Any role" })).toBeInTheDocument();
  });

  it("labels inputs, shows hints and errors", async () => {
    const { container } = render(
      <form>
        <TextField label="Name" hint="As on the contract" />
        <TextField label="Email" type="email" error="Enter a real email." />
        <TextareaField label="Notes" />
        <SelectField label="Stage" options={[{ value: "a", label: "A" }]} />
      </form>,
    );
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("As on the contract");
    expect(screen.getByLabelText("Email")).toBeInvalid();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a real email.");
    expect(screen.getByLabelText("Notes").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Stage").tagName).toBe("SELECT");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("DataTable", () => {
  it("renders rows, scrolls sideways and has no raw layout table", () => {
    render(<DataTable label="Jobs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} rowTestId={(r) => `row-${r.id}`} />);
    const table = screen.getByRole("table", { name: "Jobs" });
    expect(table.className).toContain("min-w-[40rem]");
    expect(table.parentElement?.className).toContain("overflow-auto");
    expect(screen.getByTestId("row-a")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Bravo" })).toBeInTheDocument();
  });

  it("sorts by a column, flips, then clears; empty values stay last", () => {
    render(<DataTable label="Jobs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    expect(names()).toEqual(["Bravo", "Alpha", "Charlie"]);
    fireEvent.click(screen.getByText("Name"));
    expect(names()).toEqual(["Alpha", "Bravo", "Charlie"]);
    fireEvent.click(screen.getByText("Name"));
    expect(names()).toEqual(["Charlie", "Bravo", "Alpha"]);
    fireEvent.click(screen.getByText("Name"));
    expect(names()).toEqual(["Bravo", "Alpha", "Charlie"]);
    fireEvent.click(screen.getByText("Due"));
    expect(names()).toEqual(["Charlie", "Bravo", "Alpha"]);
    fireEvent.click(screen.getByText("Due"));
    expect(names()).toEqual(["Bravo", "Charlie", "Alpha"]);
    fireEvent.click(screen.getByText("Count"));
    fireEvent.click(screen.getByText("Count"));
    expect(names()).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("starts sorted when asked", () => {
    render(<DataTable label="Jobs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} defaultSort={{ key: "name", direction: "asc" }} />);
    expect(names()).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("opens a row on click and Enter, but not from a button inside it", () => {
    const onRow = vi.fn();
    render(<DataTable label="Jobs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} onRowClick={onRow} rowTestId={(r) => `row-${r.id}`} />);
    fireEvent.click(screen.getByText("Bravo"));
    expect(onRow).toHaveBeenCalledWith(ROWS[0]);
    onRow.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Edit Bravo" }));
    expect(onRow).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId("row-b"), { key: "Enter" });
    expect(onRow).toHaveBeenCalledWith(ROWS[1]);
  });

  it("shows one empty row, and can make the header sticky", () => {
    render(<DataTable label="Jobs" columns={COLUMNS} rows={[]} rowKey={(r) => r.id} empty="No jobs yet." stickyHeader />);
    expect(screen.getByText("No jobs yet.").closest("td")?.getAttribute("colspan")).toBe("4");
    expect(screen.getByTestId("data-table").className).toContain("max-h-[70vh]");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<DataTable label="Jobs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("StatusBadge", () => {
  it("maps common words to the six statuses", () => {
    expect(statusKeyOf("Done")).toBe("done");
    expect(statusKeyOf("completed")).toBe("done");
    expect(statusKeyOf("in progress")).toBe("in_progress");
    expect(statusKeyOf("waiting_on_client")).toBe("waiting");
    expect(statusKeyOf("Overdue")).toBe("late");
    expect(statusKeyOf("blocked")).toBe("blocked");
    expect(statusKeyOf("draft")).toBe("draft");
    expect(statusKeyOf("mystery")).toBeNull();
    expect(statusKeyOf(null)).toBeNull();
  });

  it("uses red only for late", () => {
    const keys = ["done", "in_progress", "waiting", "late", "blocked", "draft", "mystery"];
    render(<>{keys.map((k) => <StatusBadge key={k} status={k} />)}</>);
    const red = keys.filter((k) => document.querySelector(`[data-status="${k === "mystery" ? "other" : k}"]`)?.className.includes("destructive"));
    expect(red).toEqual(["late"]);
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Mystery")).toBeInTheDocument();
  });

  it("accepts a custom label and shows a fallback for no status", () => {
    render(<><StatusBadge status="waiting" label="Waiting on client" /><StatusBadge status={null} /></>);
    expect(screen.getByText("Waiting on client")).toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });
});

describe("EmptyState, LoadingState, ErrorState", () => {
  it("shows an empty state with an action", () => {
    render(<EmptyState title="No crew yet" description="Add the first person." action={<button type="button">Add crew</button>} />);
    expect(screen.getByText("No crew yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add crew" })).toBeInTheDocument();
  });

  it("loads with a skeleton and a quiet status name", () => {
    const { container } = render(<LoadingState label="Loading crew" />);
    expect(screen.getByRole("status", { name: "Loading crew" })).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll(".animate-pulse").length).toBe(5);
    render(<LoadingState variant="cards" count={2} />);
  });

  it("errors with a message and Try again", () => {
    const retry = vi.fn();
    render(<ErrorState message="Could not load crew." onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load crew.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("leaves out the button when there is no retry", () => {
    render(<ErrorState message="Nope." />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("confirm dialogs", () => {
  it("ConfirmTrigger runs the action only after the person confirms", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmTrigger title="Delete Pat?" description="This cannot be undone." actionLabel="Delete" onConfirm={onConfirm}>
        <button type="button">Delete Pat</button>
      </ConfirmTrigger>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete Pat" }));
    expect(onConfirm).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("This cannot be undone.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete Pat" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  function Harness({ onResult }: { onResult: (ok: boolean) => void }) {
    const { confirm, dialog } = useConfirm();
    const [, force] = useState(0);
    return (
      <>
        <button type="button" onClick={async () => { onResult(await confirm({ title: "Revoke link?", description: "It stops working.", actionLabel: "Revoke", tone: "default" })); force((n) => n + 1); }}>
          Revoke
        </button>
        {dialog}
      </>
    );
  }

  it("useConfirm resolves true on the action and false on cancel", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false));
    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it("useConfirm resolves false on Escape", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.keyDown(await screen.findByRole("alertdialog"), { key: "Escape" });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });
});

describe("date entry point", () => {
  it("fmtWhen words empty, unreadable and real values", () => {
    expect(fmtWhen(null)).toBe("never");
    expect(fmtWhen("not a date")).toBe("unknown");
    expect(fmtWhen("2026-11-10T15:04:00Z")).toMatch(/Nov 10, 2026/);
    expect(fmtDate("2026-11-10")).toBe("Nov 10, 2026");
    expect(fmtDate(null)).toBe("Not set");
    expect(fmtDate("x", "unknown")).toBe("unknown");
  });
});
