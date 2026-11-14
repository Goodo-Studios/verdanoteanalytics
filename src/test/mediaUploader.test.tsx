/**
 * The upload panel and the media list (phase 6b): checks before anything is sent, a progress bar
 * for each file, a plain error with "Try again" for a file that failed, and a confirm before any
 * delete. The network steps are replaced; mediaUpload.test.ts covers them.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({}) }, from: () => ({}) } }));
const deleteMediaItem = vi.fn();
const removeHeadshot = vi.fn();
const setMainLocationPhoto = vi.fn();
vi.mock("@/features/dashboard/media/mediaApi", () => ({
  deleteMediaItem: (...a: unknown[]) => deleteMediaItem(...a),
  removeHeadshot: (...a: unknown[]) => removeHeadshot(...a),
  setMainLocationPhoto: (...a: unknown[]) => setMainLocationPhoto(...a),
  insertMediaRow: vi.fn(),
  setHeadshot: vi.fn(),
  removeObjects: vi.fn(),
}));

import MediaUploader from "@/features/dashboard/media/MediaUploader";
import { HeadshotControl, MediaSection } from "@/features/dashboard/media/MediaSection";
import { MEDIA_KINDS } from "@/features/dashboard/media/mediaModel";
import type { UploadJob, UploadSteps } from "@/features/dashboard/media/mediaUpload";

const MB = 1024 * 1024;
const pick = (name: string, type: string, size = 100) => new File([new Uint8Array(Math.min(size, 10))], name, { type });
const withSize = (f: File, size: number) => Object.defineProperty(f, "size", { value: size });

function setup(over: Partial<React.ComponentProps<typeof MediaUploader>> = {}, steps?: Partial<UploadSteps>) {
  const full: UploadSteps = {
    sign: vi.fn(async () => "https://storage.example.test/up?token=t"),
    put: vi.fn(async (_u: string, _f: File, p: (n: number) => void) => { p(100); }),
    save: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    ...steps,
  };
  const onUploaded = vi.fn();
  const onClose = vi.fn();
  render(<MediaUploader cfg={MEDIA_KINDS["creator-video"]} ownerId="c1" existingCount={0} onUploaded={onUploaded} onClose={onClose} steps={full} {...over} />);
  const input = document.querySelector("input[type=file]") as HTMLInputElement;
  const choose = (...files: File[]) => fireEvent.change(input, { target: { files } });
  return { full, onUploaded, onClose, choose, input };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MediaUploader", () => {
  it("accepts several files at once and uploads each, then tells the page once", async () => {
    const { full, onUploaded, choose } = setup();
    choose(pick("a.mp4", "video/mp4"), pick("b.mov", ""), pick("c.mp4", "video/mp4"));
    await waitFor(() => expect(screen.getAllByText("Uploaded")).toHaveLength(3));
    expect(full.sign).toHaveBeenCalledTimes(3);
    expect(full.save).toHaveBeenCalledTimes(3);
    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("3 uploaded");
  });

  it("shows live progress for a file while it is sent", async () => {
    let report: (n: number) => void = () => undefined;
    let finish: () => void = () => undefined;
    const { choose } = setup({}, {
      put: vi.fn((_u: string, _f: File, p: (n: number) => void) => new Promise<void>((resolve) => { report = p; finish = resolve; })),
    });
    choose(pick("long.mp4", "video/mp4"));
    const bar = await screen.findByRole("progressbar", { name: "Upload progress for long.mp4" });
    await waitFor(() => expect(screen.getByText("Uploading 0%")).toBeTruthy());
    act(() => report(45));
    expect(screen.getByText("Uploading 45%")).toBeTruthy();
    expect(bar.getAttribute("aria-valuenow")).toBe("45");
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByText("Uploaded")).toBeTruthy());
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("refuses the wrong type and too large a file before sending anything, and still uploads the good one", async () => {
    const { full, choose } = setup();
    choose(pick("ok.mp4", "video/mp4"), pick("pic.jpg", "image/jpeg"), withSize(pick("huge.mp4", "video/mp4"), 101 * MB));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/pic\.jpg is not a MP4 or MOV file/);
    expect(alert.textContent).toMatch(/huge\.mp4 is 101 MB, and the limit is 100 MB/);
    await waitFor(() => expect(screen.getByText("Uploaded")).toBeTruthy());
    expect(full.sign).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when every file is refused", () => {
    const { full, choose } = setup();
    choose(pick("notes.txt", "text/plain"));
    expect(screen.getByRole("alert").textContent).toMatch(/notes\.txt is not a MP4 or MOV file/);
    expect(full.sign).not.toHaveBeenCalled();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("stops at the number that fit, counting what is already there", async () => {
    const { full, choose } = setup({ existingCount: 9 });
    choose(pick("a.mp4", "video/mp4"), pick("b.mp4", "video/mp4"));
    expect(screen.getByRole("alert").textContent).toMatch(/b\.mp4 was not added. There is room for 10 videos/);
    await waitFor(() => expect(screen.getByText("Uploaded")).toBeTruthy());
    expect(full.sign).toHaveBeenCalledTimes(1);
  });

  it("shows a failed file's reason in plain words and uploads it on Try again", async () => {
    const put = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("The upload was interrupted."), { code: "network" }))
      .mockImplementation(async (_u: string, _f: File, p: (n: number) => void) => { p(100); });
    const { full, onUploaded, choose } = setup({}, { put });
    choose(pick("take.mp4", "video/mp4"));
    await screen.findByText("Failed");
    expect(screen.getByRole("alert").textContent).toMatch(/The upload was interrupted. Check your connection and try again./);
    expect(onUploaded).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Uploaded")).toBeTruthy());
    expect(full.sign).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it("reports a refusal by the database (a client login, or a full list) without leaving a half done row", async () => {
    const save = vi.fn().mockRejectedValue(Object.assign(new Error("creator already has 10 portfolio videos"), { code: "23514" }));
    const { onUploaded, choose } = setup({}, { save });
    choose(pick("eleven.mp4", "video/mp4"));
    await screen.findByText("Failed");
    expect(screen.getByRole("alert").textContent).toMatch(/most videos allowed/);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("keeps going when one file of several fails", async () => {
    const put = vi.fn(async (_u: string, f: File, p: (n: number) => void) => {
      if (f.name === "bad.mp4") throw Object.assign(new Error("Payload too large"), { status: 413 });
      p(100);
    });
    const { onUploaded, choose } = setup({}, { put });
    choose(pick("good1.mp4", "video/mp4"), pick("bad.mp4", "video/mp4"), pick("good2.mp4", "video/mp4"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("2 uploaded, 1 failed"));
    expect(screen.getByRole("alert").textContent).toMatch(/too large for storage \(the limit is 100 MB\)/);
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it("takes one photo for a headshot and replaces the current one", async () => {
    const jobs: UploadJob[] = [];
    const save = vi.fn(async (j: UploadJob) => { jobs.push(j); });
    const { choose } = setup({ cfg: MEDIA_KINDS["creator-headshot"], currentHeadshot: "c1/headshot-old.jpg" }, { save });
    choose(pick("one.jpg", "image/jpeg"), pick("two.jpg", "image/jpeg"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(jobs[0].currentHeadshot).toBe("c1/headshot-old.jpg");
    expect(jobs[0].file.name).toBe("one.jpg");
  });

  it("sends the family or pet choice with a creator photo", async () => {
    const jobs: UploadJob[] = [];
    const save = vi.fn(async (j: UploadJob) => { jobs.push(j); });
    const { choose } = setup({ cfg: MEDIA_KINDS["creator-photo"] }, { save });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pet" } });
    choose(pick("rex.png", "image/png"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(jobs[0].category).toBe("pet");
  });

  it("closes from its button", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("MediaSection", () => {
  const links = new Map([["c1/video-a.mp4", "https://signed.example.test/a"], ["l1/photo-a.jpg", "https://signed.example.test/pa"]]);
  const video = [{ id: "v1", storage_path: "c1/video-a.mp4", label: "Take one", extra: "talking head" }, { id: "v2", storage_path: "c1/video-gone.mp4", label: "Take two" }];
  const photos = [
    { id: "p1", storage_path: "l1/photo-a.jpg", label: "Front", sort_order: 0 },
    { id: "p2", storage_path: "l1/photo-b.jpg", label: "Kitchen", sort_order: 1 },
  ];

  it("lists the files with Play, 'File not in storage' for a missing one, and a delete on each", () => {
    render(<MediaSection cfg={MEDIA_KINDS["creator-video"]} ownerId="c1" title="Videos" items={video} links={links} onChanged={vi.fn()} />);
    const region = screen.getByRole("region", { name: "Videos" });
    expect(within(region).getByText("Videos (2)")).toBeTruthy();
    expect(within(region).getByText("Take one (talking head)")).toBeTruthy();
    expect(within(region).getByRole("link", { name: "Play" }).getAttribute("href")).toBe("https://signed.example.test/a");
    expect(within(region).getByText("File not in storage")).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Delete Take one" })).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Delete Take two" })).toBeTruthy();
  });

  it("loads the uploader only when Add is pressed", async () => {
    render(<MediaSection cfg={MEDIA_KINDS["creator-video"]} ownerId="c1" title="Videos" items={video} links={links} onChanged={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Add videos" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add videos" }));
    expect(await screen.findByRole("region", { name: "Add videos" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide uploader" }));
    expect(screen.queryByRole("region", { name: "Add videos" })).toBeNull();
  });

  it("asks first, deletes only after Delete is confirmed, then reloads", async () => {
    deleteMediaItem.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    const onNotice = vi.fn();
    render(<MediaSection cfg={MEDIA_KINDS["creator-video"]} ownerId="c1" title="Videos" items={video} links={links} onChanged={onChanged} onNotice={onNotice} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Take one" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete Take one?")).toBeTruthy();
    expect(within(dialog).getByText(/its file is deleted from storage. This cannot be undone/)).toBeTruthy();
    expect(deleteMediaItem).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteMediaItem).toHaveBeenCalledTimes(1));
    expect(deleteMediaItem).toHaveBeenCalledWith(MEDIA_KINDS["creator-video"], expect.objectContaining({ id: "v1", storage_path: "c1/video-a.mp4" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(onNotice).toHaveBeenCalledWith("Deleted Take one.");
  });

  it("deletes nothing when the confirm is cancelled", async () => {
    render(<MediaSection cfg={MEDIA_KINDS["creator-video"]} ownerId="c1" title="Videos" items={video} links={links} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Take one" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(deleteMediaItem).not.toHaveBeenCalled();
  });

  it("shows why a delete failed, keeps the item, and works on a second try", async () => {
    deleteMediaItem.mockRejectedValueOnce(Object.assign(new Error("storage is down"), { status: 500 })).mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(<MediaSection cfg={MEDIA_KINDS["creator-video"]} ownerId="c1" title="Videos" items={video} links={links} onChanged={onChanged} />);
    for (let attempt = 0; attempt < 2; attempt++) {
      fireEvent.click(screen.getByRole("button", { name: "Delete Take one" }));
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
      if (attempt === 0) {
        expect((await screen.findByRole("alert")).textContent).toBe("storage is down");
        expect(onChanged).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Delete Take one" })).toBeTruthy();
      }
    }
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(deleteMediaItem).toHaveBeenCalledTimes(2);
  });

  it("marks the first photo as main and offers 'Set as main photo' on the others", async () => {
    setMainLocationPhoto.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(<MediaSection cfg={MEDIA_KINDS["location-photo"]} ownerId="l1" title="Photos" items={photos} links={links} allowSetMain onChanged={onChanged} />);
    const region = screen.getByRole("region", { name: "Photos" });
    expect(within(region).getAllByText("Main photo")).toHaveLength(1);
    expect(within(region).queryByRole("button", { name: "Set Front as the main photo" })).toBeNull();
    fireEvent.click(within(region).getByRole("button", { name: "Set Kitchen as the main photo" }));
    await waitFor(() => expect(setMainLocationPhoto).toHaveBeenCalledWith([{ id: "p1", sort_order: 0 }, { id: "p2", sort_order: 1 }], "p2"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("offers no 'Set as main photo' for lists that have no main photo", () => {
    render(<MediaSection cfg={MEDIA_KINDS["actor-photo"]} ownerId="a1" title="Photos" items={photos} links={links} onChanged={vi.fn()} />);
    expect(screen.queryByText("Set as main photo")).toBeNull();
    expect(screen.queryByText("Main photo")).toBeNull();
  });
});

describe("HeadshotControl", () => {
  it("offers to add a main photo when there is none, and nothing to remove", () => {
    render(<HeadshotControl cfg={MEDIA_KINDS["actor-headshot"]} ownerId="a1" path={null} onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add main photo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("asks before removing, then removes the file and reloads", async () => {
    removeHeadshot.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(<HeadshotControl cfg={MEDIA_KINDS["actor-headshot"]} ownerId="a1" path="a1/headshot-x.jpg" onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(removeHeadshot).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeHeadshot).toHaveBeenCalledWith(MEDIA_KINDS["actor-headshot"], "a1", "a1/headshot-x.jpg"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("shows why a removal failed", async () => {
    removeHeadshot.mockRejectedValue(Object.assign(new Error("denied"), { code: "42501" }));
    render(<HeadshotControl cfg={MEDIA_KINDS["creator-headshot"]} ownerId="c1" path="c1/headshot-x.jpg" onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/do not have permission/);
  });
});
