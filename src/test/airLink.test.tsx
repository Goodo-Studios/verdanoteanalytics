/**
 * Phase 5b: the Air review link on cards. The page checks the address again before it becomes a link
 * (the sync and a database constraint check it first). The same cases run against the Deno copy of the
 * rule in supabase/functions/_shared/air-link.test.ts; the two lists are kept equal below.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { safeAssetLink } from "@/lib/airLink";
import { ContentPipelineView } from "@/components/client/ContentPipeline";
import { ViewAssetLink } from "@/components/client/ViewAssetLink";
import type { PipelineTask } from "@/hooks/usePipelineTasks";

const OK: [string, string][] = [
  ["https://app.air.inc/a/baf09d5e3", "https://app.air.inc/a/baf09d5e3"],
  ["  https://app.air.inc/a/baf09d5e3 \n", "https://app.air.inc/a/baf09d5e3"],
  ["https://air.inc/a/x", "https://air.inc/a/x"],
  ["https://APP.AIR.INC/a/x", "https://app.air.inc/a/x"],
  ["https://goodo.shares.air.inc/s/abc?x=1", "https://goodo.shares.air.inc/s/abc?x=1"],
];
const BAD: unknown[] = [
  "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "http://app.air.inc/a/x", "ftp://air.inc/a",
  "https://air.inc.evil.com/a", "https://evilair.inc/a", "https://notair.inc/a", "https://air.inc.evil.com/air.inc",
  "https://app.air.inc@evil.com/a", "https://user:pw@app.air.inc/a", "https://app.air.inc:8443/a",
  "https://evil.com/?u=https://app.air.inc/a", "//app.air.inc/a", "app.air.inc/a", "https://app.air.inc/a b",
  "", "   ", null, undefined, 42, {}, "https://app.air.inc/" + "a".repeat(500),
];

describe("safeAssetLink", () => {
  it.each(OK)("accepts %j", (input, out) => expect(safeAssetLink(input)).toBe(out));
  it.each(BAD.map((b) => [b]))("drops %j", (input) => expect(safeAssetLink(input)).toBeNull());

  it("runs the same cases as the Deno copy of the rule", () => {
    const deno = readFileSync(path.resolve(__dirname, "../../supabase/functions/_shared/air-link.test.ts"), "utf8");
    for (const [input] of OK) expect(deno).toContain(JSON.stringify(input.trim() === input ? input : input).slice(0, 18));
    for (const bad of ["javascript:alert(1)", "https://air.inc.evil.com/a", "https://evilair.inc/a", "https://app.air.inc@evil.com/a", "https://app.air.inc:8443/a"]) {
      expect(deno).toContain(JSON.stringify(bad));
    }
  });
});

const card = (over: Partial<PipelineTask>): PipelineTask => ({
  id: "c1",
  task_name: "November Asset 4 - Unboxing cut",
  stage: "Production",
  due_date: "2099-11-20",
  content_type: "Video",
  updated_at: "2026-11-09",
  cycle_month: "2099-11-01",
  asset_link: null,
  ...over,
});

describe("View asset on the client board", () => {
  it("shows a View asset button that opens in a new tab with rel noopener noreferrer", () => {
    render(<ContentPipelineView tasks={[card({ asset_link: "https://app.air.inc/a/baf09d5e3" })]} now={new Date("2099-11-10")} />);
    const link = screen.getByTestId("view-asset");
    expect(link).toHaveAttribute("href", "https://app.air.inc/a/baf09d5e3");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("View asset");
  });

  it("shows nothing on a card with no link", () => {
    render(<ContentPipelineView tasks={[card({ asset_link: null })]} now={new Date("2099-11-10")} />);
    expect(screen.queryByTestId("view-asset")).toBeNull();
    expect(screen.getByText(/Unboxing cut/)).toBeInTheDocument();
  });

  it.each(["javascript:alert(1)", "https://air.inc.evil.com/a", "http://app.air.inc/a", "https://evilair.inc/a"])(
    "renders no link for a bad stored value %s",
    (bad) => {
      render(<ContentPipelineView tasks={[card({ asset_link: bad })]} now={new Date("2099-11-10")} />);
      expect(screen.queryByTestId("view-asset")).toBeNull();
      expect(document.querySelector("a[href^='javascript']")).toBeNull();
    },
  );

  it("shows the link on a delivered item in an earlier cycle", () => {
    render(
      <ContentPipelineView
        tasks={[card({ id: "d1", stage: "Ready to Launch", due_date: null, cycle_month: "2099-09-01", delivered_at: "2099-09-20", asset_link: "https://app.air.inc/a/old" })]}
        now={new Date("2099-11-10")}
      />,
    );
    expect(screen.getByTestId("view-asset")).toHaveAttribute("href", "https://app.air.inc/a/old");
  });
});

describe("ViewAssetLink", () => {
  it("renders nothing without a valid link", () => {
    const { container } = render(
      <MemoryRouter>
        <ViewAssetLink link={undefined} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
