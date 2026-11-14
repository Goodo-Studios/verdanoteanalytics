/**
 * One file from the browser to storage (phase 6b): a signed upload link first, then the file with
 * progress, then the row; a row that cannot be added takes the file out of storage again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({}) }, from: () => ({}) } }));

import { MEDIA_KINDS } from "@/features/dashboard/media/mediaModel";
import { putWithProgress, uploadMediaFile, type UploadJob, type UploadSteps } from "@/features/dashboard/media/mediaUpload";

const blob = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

function job(over: Partial<UploadJob> = {}): UploadJob {
  return { cfg: MEDIA_KINDS["creator-video"], ownerId: "c1", file: blob("take.mp4", "video/mp4"), mime: "video/mp4", onProgress: vi.fn(), ...over };
}

function steps(over: Partial<UploadSteps> = {}): UploadSteps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    sign: vi.fn(async (bucket: string, path: string) => { calls.push(`sign ${bucket} ${path}`); return "https://storage.example.test/upload?token=t"; }),
    put: vi.fn(async (_url: string, f: File, onProgress: (p: number) => void) => { calls.push(`put ${f.name} ${f.type}`); onProgress(40); onProgress(100); }),
    save: vi.fn(async (_j: UploadJob, path: string) => { calls.push(`save ${path}`); }),
    remove: vi.fn(async (bucket: string, path: string) => { calls.push(`remove ${bucket} ${path}`); }),
    ...over,
  };
}

describe("uploadMediaFile", () => {
  it("signs, sends with progress, then saves the row, in that order", async () => {
    const s = steps();
    const j = job();
    const path = await uploadMediaFile(j, s);
    expect(path).toMatch(/^c1\/video-[0-9a-f-]{36}\.mp4$/);
    expect(s.calls).toEqual([`sign creator-videos ${path}`, "put take.mp4 video/mp4", `save ${path}`]);
    expect(j.onProgress).toHaveBeenCalledWith(40);
    expect(j.onProgress).toHaveBeenLastCalledWith(100);
  });

  it("tells the caller when it moves from sending to saving", async () => {
    const onSaving = vi.fn();
    await uploadMediaFile(job({ onSaving }), steps());
    expect(onSaving).toHaveBeenCalledTimes(1);
  });

  it("sends a file whose type the browser left blank with the checked type", async () => {
    const s = steps();
    await uploadMediaFile(job({ file: blob("take.mov", ""), mime: "video/quicktime" }), s);
    expect(s.calls[1]).toBe("put take.mov video/quicktime");
    expect(s.calls[0]).toMatch(/\.mov$/);
  });

  it("sends nothing and saves nothing when signing is refused", async () => {
    const s = steps({ sign: vi.fn(async () => { throw new Error("new row violates row-level security policy"); }) });
    await expect(uploadMediaFile(job(), s)).rejects.toThrow(/row-level security/);
    expect(s.put).not.toHaveBeenCalled();
    expect(s.save).not.toHaveBeenCalled();
    expect(s.remove).not.toHaveBeenCalled();
  });

  it("saves no row when the send fails, and has nothing to clean up", async () => {
    const s = steps({ put: vi.fn(async () => { throw new Error("The upload was interrupted."); }) });
    await expect(uploadMediaFile(job(), s)).rejects.toThrow(/interrupted/);
    expect(s.save).not.toHaveBeenCalled();
    expect(s.remove).not.toHaveBeenCalled();
  });

  it("takes the file out of storage again when the row cannot be saved", async () => {
    const s = steps({ save: vi.fn(async () => { throw Object.assign(new Error("limit"), { code: "23514" }); }) });
    await expect(uploadMediaFile(job(), s)).rejects.toMatchObject({ code: "23514" });
    expect(s.remove).toHaveBeenCalledWith("creator-videos", expect.stringMatching(/^c1\/video-/));
  });

  it("still reports the save error when the cleanup fails too", async () => {
    const s = steps({
      save: vi.fn(async () => { throw new Error("row failed"); }),
      remove: vi.fn(async () => { throw new Error("cleanup failed"); }),
    });
    await expect(uploadMediaFile(job(), s)).rejects.toThrow("row failed");
  });
});

// A just-enough XMLHttpRequest to drive putWithProgress.
class FakeXhr {
  static last: FakeXhr;
  method = ""; url = ""; status = 0; responseText = "";
  headers: Record<string, string> = {};
  body: FormData | null = null;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() { FakeXhr.last = this; }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  send(body: FormData) { this.body = body; }
}

describe("putWithProgress", () => {
  beforeEach(() => { vi.stubGlobal("XMLHttpRequest", FakeXhr); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("PUTs a form with the file to the signed link and reports progress up to 100", async () => {
    const seen: number[] = [];
    const p = putWithProgress("https://storage.example.test/upload/sign/b/p?token=t", blob("a.jpg", "image/jpeg", 100), (n) => seen.push(n), "anon-key");
    const x = FakeXhr.last;
    expect(x.method).toBe("PUT");
    expect(x.url).toContain("token=t");
    expect(x.headers["x-upsert"]).toBe("false");
    expect(x.headers.apikey).toBe("anon-key");
    expect(x.body!.get("cacheControl")).toBe("3600");
    expect((x.body!.get("") as File).name).toBe("a.jpg");
    x.upload.onprogress!({ lengthComputable: true, loaded: 25, total: 100 });
    x.upload.onprogress!({ lengthComputable: true, loaded: 100, total: 100 });
    x.upload.onprogress!({ lengthComputable: false, loaded: 0, total: 0 });
    x.status = 200;
    x.onload!();
    await p;
    expect(seen).toEqual([25, 100, 100]);
  });

  it("rejects with storage's own message and status when it refuses the file", async () => {
    const p = putWithProgress("https://s.example.test/u", blob("a.jpg", "image/jpeg"), () => undefined, "k");
    const x = FakeXhr.last;
    x.status = 413;
    x.responseText = JSON.stringify({ statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" });
    x.onload!();
    await expect(p).rejects.toMatchObject({ status: 413, message: "The object exceeded the maximum allowed size" });
  });

  it("rejects as a dropped connection on a network error, timeout or abort", async () => {
    for (const hook of ["onerror", "ontimeout", "onabort"] as const) {
      const p = putWithProgress("https://s.example.test/u", blob("a.jpg", "image/jpeg"), () => undefined, "k");
      FakeXhr.last[hook]!();
      await expect(p).rejects.toMatchObject({ code: "network" });
    }
  });
});
