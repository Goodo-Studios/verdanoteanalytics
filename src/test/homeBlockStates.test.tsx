/** Home blocks use the kit's skeleton, error (with Try again) and empty states. */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { HomeBlock } from "@/features/home/HomeBlock";

const base = { id: "due", title: "Due this week", rows: [], emptyText: "Nothing is due.", seeAllTo: "/work", prefix: "/builder" };
const renderBlock = (props: Partial<Parameters<typeof HomeBlock>[0]>) =>
  render(
    <MemoryRouter>
      <HomeBlock {...base} status="ready" {...props} />
    </MemoryRouter>,
  );

describe("HomeBlock states", () => {
  it("loads as a skeleton with a quiet status name, not the word Loading on screen", () => {
    const { container } = renderBlock({ status: "loading" });
    expect(screen.getByRole("status", { name: "Loading Due this week" })).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("errors with a working Try again", () => {
    const retry = vi.fn();
    renderBlock({ status: "error", onRetry: retry });
    expect(screen.getByRole("alert")).toHaveTextContent("not the same as being empty");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("says plainly when empty", () => {
    renderBlock({});
    expect(screen.getByTestId("home-block-due-empty")).toHaveTextContent("Nothing is due.");
  });
});
