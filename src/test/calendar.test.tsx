/**
 * The shared Calendar (react-day-picker) keeps working across the React 19 upgrade.
 *
 * react-day-picker 8 declares React 18 as its newest supported version, which blocks React 19.
 * Version 9 supports it, and renames nearly every class name and slot. These tests describe what
 * the calendar must do for DateRangeFilter and the report pickers, without naming any
 * react-day-picker element or class slot, so they pass on both versions: the month and its days
 * show, a range is marked selected, today is marked, a click selects a day, and the month
 * navigation works.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Calendar } from "@/components/ui/calendar";

const NOV_2026 = new Date(2026, 10, 1);

describe("Calendar", () => {
  it("shows the month with its days and seven weekday headings", () => {
    render(<Calendar mode="single" defaultMonth={NOV_2026} showOutsideDays={false} />);
    expect(screen.getByText(/November 2026/)).toBeTruthy();
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
    for (const day of ["1", "15", "30"]) expect(screen.getByText(day)).toBeTruthy();
    expect(screen.queryByText("31")).toBeNull();
  });

  it("marks every day of a selected range as selected", () => {
    const { container } = render(
      <Calendar
        mode="range"
        defaultMonth={NOV_2026}
        showOutsideDays={false}
        selected={{ from: new Date(2026, 10, 10), to: new Date(2026, 10, 12) }}
      />,
    );
    const selected = [...container.querySelectorAll('[aria-selected="true"]')].map((el) => el.textContent?.replace(/\D/g, ""));
    expect(selected.sort()).toEqual(["10", "11", "12"]);
  });

  it("marks today differently from other days", () => {
    const { container } = render(
      <Calendar mode="single" defaultMonth={NOV_2026} showOutsideDays={false} today={new Date(2026, 10, 15)} />,
    );
    const ringed = [...container.querySelectorAll("*")].filter((el) => el.className?.toString().includes("ring-verdant/50"));
    expect(ringed).toHaveLength(1);
    expect(ringed[0].textContent).toContain("15");
  });

  it("reports the day that is clicked", () => {
    const onSelect = vi.fn();
    render(<Calendar mode="single" defaultMonth={NOV_2026} showOutsideDays={false} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("20"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const picked = onSelect.mock.calls[0][0] as Date;
    expect([picked.getFullYear(), picked.getMonth(), picked.getDate()]).toEqual([2026, 10, 20]);
  });

  it("moves to the next and previous month", () => {
    render(<Calendar mode="single" defaultMonth={NOV_2026} showOutsideDays={false} />);
    fireEvent.click(screen.getByRole("button", { name: /next month/i }));
    expect(screen.getByText(/December 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /previous month/i }));
    fireEvent.click(screen.getByRole("button", { name: /previous month/i }));
    expect(screen.getByText(/October 2026/)).toBeTruthy();
  });

  it("shows days of the neighbouring months when asked to", () => {
    render(<Calendar mode="single" defaultMonth={NOV_2026} />);
    // November 2026 starts on a Sunday, so the first row has no October days; the last row
    // ends with early December days.
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(2);
  });
});
