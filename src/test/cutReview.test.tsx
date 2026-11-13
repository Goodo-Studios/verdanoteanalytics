/**
 * OS-020 cut review: timecode parse and format, the version picker (latest first), comment order,
 * clicking a timecode seeks the player, a comment takes the player's time or a typed m:ss, the
 * client view never draws internal comments, and the staff panel lists versions with both threads.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatTimecode,
  isDirectVideo,
  parseTimecode,
  seekTo,
  sortByTimecode,
  toCutComments,
  toVersions,
  versionName,
} from "@/lib/cutReview";

const h = vi.hoisted(() => ({
  versions: [] as unknown[],
  comments: {} as Record<string, unknown[]>,
  rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  tables: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const q = {
      eq: () => q,
      order: () => q,
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve({ data: table === "os_task_versions" ? h.versions : [], error: null }).then(ok, bad),
    };
    return q;
  };
  return {
    supabase: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        h.rpcs.push({ fn, args });
        if (fn === "os_client_task_versions") return Promise.resolve({ data: h.versions, error: null });
        if (fn === "list_task_version_comments") return Promise.resolve({ data: h.comments[String(args.p_version_id)] ?? [], error: null });
        return Promise.resolve({ data: { version_no: 3 }, error: null });
      },
      from: (table: string) => {
        h.tables.push(table);
        return { select: () => chain(table) };
      },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-me" } }) }));

import { CutReview } from "@/features/cut-review/CutReview";

const v = (id: string, no: number, url = `https://cdn.example.test/${id}.mp4`, label: string | null = null) => ({
  id,
  version_no: no,
  label,
  video_url: url,
  created_at: `2026-11-0${no}T10:00:00Z`,
});
const c = (id: number, thread: string, body: string, timecode_ms: number | null, created_at = "2026-11-05T10:00:00Z") => ({
  id,
  thread,
  body,
  timecode_ms,
  created_at,
  author_user_id: id === 1 ? "u-me" : "u-other",
  author: { name: "Sam" },
});

function renderIt(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  h.versions = [];
  h.comments = {};
  h.rpcs = [];
  h.tables = [];
});
afterEach(() => vi.restoreAllMocks());

describe("timecodes", () => {
  it("formats m:ss and h:mm:ss", () => {
    expect(formatTimecode(0)).toBe("0:00");
    expect(formatTimecode(65_000)).toBe("1:05");
    expect(formatTimecode(65_999)).toBe("1:05");
    expect(formatTimecode(3_723_000)).toBe("1:02:03");
    expect(formatTimecode(-5)).toBe("0:00");
  });

  it("parses m:ss and h:mm:ss", () => {
    expect(parseTimecode("1:05")).toBe(65_000);
    expect(parseTimecode("01:05")).toBe(65_000);
    expect(parseTimecode(" 0:00 ")).toBe(0);
    expect(parseTimecode("1:02:03")).toBe(3_723_000);
    expect(parseTimecode("75:00")).toBe(4_500_000);
  });

  it("refuses anything else", () => {
    for (const bad of ["", "65", "1:5", "1:60", "1:60:00", "a:bc", "1:02:03:04", "-1:00", "1.5:00"]) {
      expect(parseTimecode(bad), bad).toBeNull();
    }
  });

  it("round-trips", () => {
    for (const ms of [0, 5_000, 59_000, 600_000, 3_600_000, 7_265_000]) {
      expect(parseTimecode(formatTimecode(ms))).toBe(ms);
    }
  });
});

describe("rules", () => {
  it("knows which links play inline", () => {
    expect(isDirectVideo("https://cdn.example.test/a/cut.mp4")).toBe(true);
    expect(isDirectVideo("https://cdn.example.test/cut.webm?sig=1")).toBe(true);
    expect(isDirectVideo("http://cdn.example.test/cut.mp4")).toBe(false);
    expect(isDirectVideo("https://air.inc/a/b")).toBe(false);
    expect(isDirectVideo("https://drive.google.com/file/d/x/view")).toBe(false);
    expect(isDirectVideo("not a url")).toBe(false);
  });

  it("sorts versions latest first and drops bad rows", () => {
    const out = toVersions([v("a", 1), v("c", 3), { id: "x", video_url: "http://bad" }, null, v("b", 2, "https://x.test/b.mp4", "Short hook")]);
    expect(out.map((r) => r.version_no)).toEqual([3, 2, 1]);
    expect(versionName(out[1])).toBe("Version 2: Short hook");
    expect(versionName(out[0])).toBe("Version 3");
  });

  it("sorts comments by timecode, whole-cut last, then by time posted", () => {
    const out = sortByTimecode([
      { id: 1, timecode_ms: null, created_at: "2026-11-01" },
      { id: 2, timecode_ms: 9_000, created_at: "2026-11-03" },
      { id: 3, timecode_ms: 1_000, created_at: "2026-11-04" },
      { id: 4, timecode_ms: 9_000, created_at: "2026-11-02" },
    ]);
    expect(out.map((r) => r.id)).toEqual([3, 4, 2, 1]);
  });

  it("drops internal comments for a client even if the server sent them", () => {
    const rows = [c(1, "client", "keep", 1000), c(2, "internal", "secret", 500), c(3, "bogus", "x", 1)];
    expect(toCutComments(rows, { clientOnly: true }).map((r) => r.body)).toEqual(["keep"]);
    expect(toCutComments(rows, { clientOnly: false }).map((r) => r.body)).toEqual(["secret", "keep"]);
  });
});

describe("seek", () => {
  it("sets the player's time in seconds", () => {
    const video = document.createElement("video");
    let set = -1;
    Object.defineProperty(video, "currentTime", { get: () => set, set: (s: number) => { set = s; } });
    seekTo(video, 65_500);
    expect(set).toBe(65.5);
    expect(() => seekTo(null, 1)).not.toThrow();
  });
});

describe("client view", () => {
  it("picks the latest version, plays a direct file inline and lists comments by timecode", async () => {
    h.versions = [v("v1", 1), v("v2", 2)];
    h.comments = { v2: [c(1, "client", "Second", 30_000), c(2, "client", "First", 5_000)], v1: [c(5, "client", "Old one", 1_000)] };
    renderIt(<CutReview taskId="t1" viewer="client" />);
    const pills = await screen.findAllByTestId("cut-version");
    expect(pills.map((p) => p.textContent)).toEqual([expect.stringContaining("Version 2"), expect.stringContaining("Version 1")]);
    expect(pills[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("cut-player")).toHaveAttribute("src", "https://cdn.example.test/v2.mp4");
    await waitFor(() => expect(screen.getAllByTestId("cut-comment")).toHaveLength(2));
    expect(screen.getAllByTestId("cut-comment").map((li) => li.textContent)).toEqual([
      expect.stringContaining("First"),
      expect.stringContaining("Second"),
    ]);
    expect(h.rpcs.some((r) => r.fn === "os_client_task_versions" && r.args.p_task_id === "t1")).toBe(true);
    expect(h.tables).toEqual([]);

    fireEvent.click(pills[1]);
    await waitFor(() => expect(screen.getByText("Old one")).toBeInTheDocument());
    expect(screen.getByTestId("cut-player")).toHaveAttribute("src", "https://cdn.example.test/v1.mp4");
  });

  it("seeks the player when a timecode is clicked", async () => {
    h.versions = [v("v2", 2)];
    h.comments = { v2: [c(1, "client", "Look here", 12_000)] };
    let set = -1;
    vi.spyOn(HTMLMediaElement.prototype, "currentTime", "set").mockImplementation((s: number) => { set = s; });
    renderIt(<CutReview taskId="t1" viewer="client" />);
    fireEvent.click(await screen.findByRole("button", { name: "Go to 0:12" }));
    expect(set).toBe(12);
  });

  it("stamps a new comment with the player's current time, in the client thread", async () => {
    h.versions = [v("v2", 2)];
    vi.spyOn(HTMLMediaElement.prototype, "currentTime", "get").mockReturnValue(42.7);
    renderIt(<CutReview taskId="t1" viewer="client" />);
    await screen.findByTestId("cut-player");
    expect(screen.queryByLabelText("Thread")).toBeNull();
    fireEvent.change(screen.getByLabelText("Add a comment on this version"), { target: { value: "Cut this" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(h.rpcs.some((r) => r.fn === "post_task_version_comment")).toBe(true));
    expect(h.rpcs.find((r) => r.fn === "post_task_version_comment")!.args).toEqual({
      p_version_id: "v2",
      p_thread: "client",
      p_body: "Cut this",
      p_timecode_ms: 42_700,
    });
  });

  it("shows Open the cut and a m:ss field for links that cannot play inline", async () => {
    h.versions = [v("v1", 1, "https://air.inc/review/abc")];
    renderIt(<CutReview taskId="t1" viewer="client" />);
    const link = await screen.findByTestId("cut-open-link");
    expect(link).toHaveTextContent("Open the cut");
    expect(link).toHaveAttribute("href", "https://air.inc/review/abc");
    expect(screen.queryByTestId("cut-player")).toBeNull();

    fireEvent.change(screen.getByLabelText("Add a comment on this version"), { target: { value: "Hmm" } });
    fireEvent.change(screen.getByLabelText("Time (m:ss)"), { target: { value: "1:7" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("m:ss");
    expect(h.rpcs.some((r) => r.fn === "post_task_version_comment")).toBe(false);

    fireEvent.change(screen.getByLabelText("Time (m:ss)"), { target: { value: "1:07" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(h.rpcs.find((r) => r.fn === "post_task_version_comment")?.args.p_timecode_ms).toBe(67_000));
  });

  it("never renders internal comments", async () => {
    h.versions = [v("v2", 2)];
    h.comments = { v2: [c(1, "client", "For you", 1_000), c(2, "internal", "Staff only note", 2_000)] };
    renderIt(<CutReview taskId="t1" viewer="client" />);
    await waitFor(() => expect(screen.getByText("For you")).toBeInTheDocument());
    expect(screen.queryByText("Staff only note")).toBeNull();
    expect(screen.queryByTestId("cut-internal-label")).toBeNull();
    expect(screen.queryByText("Sam", { exact: false })).toBeNull();
  });

  it("says when there is no cut yet and offers no add form", async () => {
    renderIt(<CutReview taskId="t1" viewer="client" />);
    expect(await screen.findByTestId("cut-no-versions")).toHaveTextContent("No cut to watch yet.");
    expect(screen.queryByTestId("cut-add-version")).toBeNull();
  });
});

describe("staff panel view", () => {
  it("lists versions from the table and shows both threads with Internal labelled", async () => {
    h.versions = [v("v1", 1), v("v2", 2, "https://drive.google.com/file/d/x/view", "Shorter")];
    h.comments = { v2: [c(1, "internal", "Tighten the hook", 3_000), c(2, "client", "Love it", null)] };
    renderIt(<CutReview taskId="t9" viewer="staff" canAdd />);
    const pills = await screen.findAllByTestId("cut-version");
    expect(pills[0]).toHaveTextContent("Version 2: Shorter");
    expect(h.tables).toEqual(["os_task_versions"]);
    expect(h.rpcs.some((r) => r.fn === "os_client_task_versions")).toBe(false);
    await waitFor(() => expect(screen.getAllByTestId("cut-comment")).toHaveLength(2));
    const [first, second] = screen.getAllByTestId("cut-comment");
    expect(first).toHaveAttribute("data-thread", "internal");
    expect(within(first).getByTestId("cut-internal-label")).toHaveTextContent("Internal");
    expect(within(second).queryByTestId("cut-internal-label")).toBeNull();
    expect(second).toHaveTextContent("Whole cut");
  });

  it("posts in the chosen thread and adds a version", async () => {
    h.versions = [v("v1", 1)];
    renderIt(<CutReview taskId="t9" viewer="staff" canAdd />);
    await screen.findByTestId("cut-player");
    fireEvent.change(screen.getByLabelText("Thread"), { target: { value: "client" } });
    fireEvent.click(screen.getByTestId("cut-at-time"));
    fireEvent.change(screen.getByLabelText("Add a comment on this version"), { target: { value: "Here is v1" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(h.rpcs.find((r) => r.fn === "post_task_version_comment")?.args).toEqual({
        p_version_id: "v1",
        p_thread: "client",
        p_body: "Here is v1",
        p_timecode_ms: null,
      }),
    );

    fireEvent.change(screen.getByLabelText("Link to the cut"), { target: { value: " https://cdn.example.test/v2.mp4 " } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Shorter" } });
    fireEvent.click(screen.getByRole("button", { name: "Add version" }));
    await waitFor(() =>
      expect(h.rpcs.find((r) => r.fn === "os_add_task_version")?.args).toEqual({
        p_task_id: "t9",
        p_video_url: "https://cdn.example.test/v2.mp4",
        p_label: "Shorter",
      }),
    );
  });

  it("hides the add form when the task is read-only", async () => {
    renderIt(<CutReview taskId="t9" viewer="staff" canAdd={false} />);
    expect(await screen.findByTestId("cut-no-versions")).toHaveTextContent("No versions yet.");
    expect(screen.queryByTestId("cut-add-version")).toBeNull();
  });
});
