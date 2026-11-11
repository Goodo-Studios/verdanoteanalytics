/**
 * The public creator and actor application forms: states (valid, rate limited, expired, error,
 * success), the hidden field, file checks, and uploads that go to the signed address.
 * The function and the database are covered in supabase/functions/public-apply and
 * supabase/tests/public_applications_test.sql.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadToSignedUrl = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ uploadToSignedUrl: (...a: unknown[]) => uploadToSignedUrl(...a) }) } },
}));

import PublicApplyPage from "@/features/public-links/PublicApplyPage";
import { HONEYPOT_FIELD, checkFile } from "@/features/public-links/applyApi";

const DRAFT = "11111111-1111-4111-8111-111111111111";
const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
let fetchMock: ReturnType<typeof vi.fn>;
const bodies = () => fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));

beforeEach(() => {
  uploadToSignedUrl.mockReset().mockResolvedValue({ error: null });
  fetchMock = vi.fn();
  fetchMock.mockImplementation((_u: string, init: { body: string }) => {
    const b = JSON.parse(init.body);
    if (b.action === "begin") return reply(200, { draft_id: DRAFT });
    if (b.action === "upload_url") return reply(200, { path: `applications/${DRAFT}/${b.file_kind}/x.${b.file_kind === "video" ? "mp4" : "jpg"}`, bucket: "creator-application-videos", token: "tok" });
    return reply(200, { ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const file = (name: string, type: string, size = 1000) => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};
const fill = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const addVideos = async (n: number) => {
  const input = screen.getByLabelText(/^Videos/);
  for (let i = 0; i < n; i++) {
    fireEvent.change(input, { target: { files: [file(`v${i}.mp4`, "video/mp4")] } });
    await waitFor(() => expect(screen.getByText(new RegExp(`Videos \\(${i + 1} added`))).toBeTruthy());
  }
};

describe("creator application form", () => {
  it("starts a draft, shows the form with no staff menu, and keeps the hidden field out of view", async () => {
    render(<PublicApplyPage kind="creator" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Apply to create with Goodo Studios" })).toBeTruthy();
    expect(bodies()[0]).toEqual({ kind: "creator", action: "begin" });
    expect(screen.queryByRole("navigation")).toBeNull();
    const trap = document.querySelector(`input[name="${HONEYPOT_FIELD}"]`) as HTMLInputElement;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest("[aria-hidden='true']")).toBeTruthy();
  });

  it("explains each way the form cannot start", async () => {
    fetchMock.mockImplementation(() => reply(429, { error: "rate_limited" }));
    render(<PublicApplyPage kind="creator" />);
    expect((await screen.findByRole("alert")).textContent).toContain("wait a minute");
    fetchMock.mockImplementation(() => reply(500, { error: "server_error" }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("try again in a moment"));
  });

  it("asks for what is missing before sending anything", async () => {
    render(<PublicApplyPage kind="creator" />);
    await screen.findByLabelText("Your name");
    fireEvent.click(screen.getByRole("button", { name: "Send my application" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Please add your name.");
    fill("Your name", "Pat");
    fill("Email", "nope");
    fireEvent.click(screen.getByRole("button", { name: "Send my application" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Please add a valid email address.");
    fill("Email", "pat@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Send my application" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Please add at least 3 videos.");
    expect(bodies().some((b) => b.action === "submit")).toBe(false);
  });

  it("refuses a wrong type or an oversized file with a plain sentence and uploads nothing", async () => {
    render(<PublicApplyPage kind="creator" />);
    await screen.findByLabelText("Your name");
    fireEvent.change(screen.getByLabelText(/^Videos/), { target: { files: [file("a.pdf", "application/pdf")] } });
    expect((await screen.findByRole("alert")).textContent).toBe("Please use an MP4, MOV or WebM video.");
    fireEvent.change(screen.getByLabelText(/^Photo of you/), { target: { files: [file("a.jpg", "image/jpeg", 6 * 1024 * 1024)] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("That photo is over 5 MB. Please use a smaller one."));
    expect(bodies().some((b) => b.action === "upload_url")).toBe(false);
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("uploads to the signed address and submits with the draft id, files and an empty hidden field", async () => {
    render(<PublicApplyPage kind="creator" />);
    await screen.findByLabelText("Your name");
    fill("Your name", "Pat");
    fill("Email", "pat@example.test");
    await addVideos(3);
    expect(uploadToSignedUrl).toHaveBeenCalledTimes(3);
    expect(uploadToSignedUrl.mock.calls[0].slice(0, 2)).toEqual([`applications/${DRAFT}/video/x.mp4`, "tok"]);
    fireEvent.click(screen.getByRole("button", { name: "Send my application" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Thank you" })).toBeTruthy();
    const submit = bodies().find((b) => b.action === "submit");
    expect(submit.draft_id).toBe(DRAFT);
    expect(submit[HONEYPOT_FIELD]).toBe("");
    expect(submit.payload.videos).toHaveLength(3);
    expect(submit.payload.name).toBe("Pat");
  });

  it.each([
    [410, { error: "expired" }, "open a long time"],
    [429, { error: "rate_limited" }, "That was a lot of tries"],
    [500, { error: "server_error" }, "Something went wrong on our side"],
    [400, { error: "invalid", field: "files" }, "One of your files is missing"],
  ])("explains a %s answer to the submit", async (status, body, text) => {
    render(<PublicApplyPage kind="creator" />);
    await screen.findByLabelText("Your name");
    fill("Your name", "Pat");
    fill("Email", "pat@example.test");
    await addVideos(3);
    fetchMock.mockImplementation((_u: string, init: { body: string }) => (JSON.parse(init.body).action === "submit" ? reply(status, body) : reply(200, {})));
    fireEvent.click(screen.getByRole("button", { name: "Send my application" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(text));
    expect(screen.queryByRole("heading", { name: "Thank you" })).toBeNull();
  });

  it("says so when a file does not upload", async () => {
    uploadToSignedUrl.mockResolvedValue({ error: { message: "boom" } });
    render(<PublicApplyPage kind="creator" />);
    await screen.findByLabelText("Your name");
    fireEvent.change(screen.getByLabelText(/^Videos/), { target: { files: [file("a.mp4", "video/mp4")] } });
    expect((await screen.findByRole("alert")).textContent).toBe("That file did not upload. Please try again.");
  });
});

describe("actor application form", () => {
  it("needs gender and an age range, and needs one video", async () => {
    render(<PublicApplyPage kind="actor" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Apply to be on camera with Goodo Studios" })).toBeTruthy();
    fill("Your name", "Ari");
    fill("Email", "ari@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Send my application" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Please choose an option for gender.");
    fill("Gender", "Woman");
    fireEvent.click(screen.getByRole("button", { name: "Send my application" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Please choose at least one age range.");
    fireEvent.click(screen.getByLabelText("25-34"));
    fireEvent.click(screen.getByRole("button", { name: "Send my application" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Please add at least 1 video.");
    await addVideos(1);
    fireEvent.click(screen.getByLabelText("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Send my application" }));
    expect(await screen.findByRole("heading", { name: "Thank you" })).toBeTruthy();
    const submit = bodies().find((b) => b.action === "submit");
    expect(submit.kind).toBe("actor");
    expect(submit.payload.dog_owner).toBe(true);
    expect(submit.payload.age_range).toEqual(["25-34"]);
  });
});

describe("file checks", () => {
  it("accepts the allowed types and sizes only", () => {
    expect(checkFile({ type: "image/png", size: 10 }, "headshot")).toBeNull();
    expect(checkFile({ type: "video/quicktime", size: 10 }, "video")).toBeNull();
    expect(checkFile({ type: "image/gif", size: 10 }, "headshot")).toMatch(/JPG, PNG or WebP/);
    expect(checkFile({ type: "video/mp4", size: 251 * 1024 * 1024 }, "video")).toMatch(/over 250 MB/);
    expect(checkFile({ type: "video/mp4", size: 0 }, "video")).toBe("That file is empty.");
  });
});
