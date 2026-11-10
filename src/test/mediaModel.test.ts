/**
 * Media upload rules (phase 6b): which files are accepted for each kind of media, how paths are
 * named so new files sit beside the ones copied from the old dashboard, and the plain wording
 * of errors. Pure functions only; the calls are tested in mediaApi.test.ts and mediaUpload.test.ts.
 */
import { describe, expect, it } from "vitest";
import { mainFirstOrder } from "@/features/dashboard/media/mediaApi";
import {
  MEDIA_KINDS,
  acceptFor,
  buildPath,
  formatBytes,
  limitsText,
  mediaErrorText,
  mimeOf,
  nextSortOrder,
  summarizeQueue,
  titleFromName,
  validateBatch,
  validateFile,
} from "@/features/dashboard/media/mediaModel";
import { isStorageSecretError, storageSecretsText } from "@/features/dashboard/media/storageSecrets";
import { reviewErrorText } from "@/features/dashboard/applicationsModel";

const file = (name: string, type: string, size = 1000) => ({ name, type, size }) as File;
const MB = 1024 * 1024;

describe("which files are accepted", () => {
  const photo = MEDIA_KINDS["location-photo"];
  const video = MEDIA_KINDS["creator-video"];

  it("accepts JPG, PNG and WebP photos and MP4 and MOV videos, and nothing else", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp"]) expect(validateFile(photo, file("a", t))).toBeNull();
    for (const t of ["video/mp4", "video/quicktime"]) expect(validateFile(video, file("a", t))).toBeNull();
    expect(validateFile(photo, file("a.gif", "image/gif"))).toMatch(/not a JPG, PNG or WebP file/);
    expect(validateFile(photo, file("clip.mp4", "video/mp4"))).toMatch(/not a JPG, PNG or WebP file/);
    expect(validateFile(video, file("a.webm", "video/webm"))).toMatch(/not a MP4 or MOV file/);
    expect(validateFile(video, file("pic.jpg", "image/jpeg"))).toMatch(/not a MP4 or MOV file/);
  });

  it("reads the type from the extension when the browser leaves it blank (common for .mov)", () => {
    expect(mimeOf(file("take1.MOV", ""))).toBe("video/quicktime");
    expect(mimeOf(file("pic.jpeg", ""))).toBe("image/jpeg");
    expect(mimeOf(file("notes.txt", ""))).toBe("");
    expect(validateFile(video, file("take1.mov", ""))).toBeNull();
    expect(validateFile(photo, file("notes.txt", ""))).toMatch(/not a JPG/);
  });

  it("refuses an empty file and one over the bucket's limit, naming the limit", () => {
    expect(validateFile(photo, file("a.jpg", "image/jpeg", 0))).toMatch(/is empty/);
    expect(validateFile(photo, file("a.jpg", "image/jpeg", 5 * MB))).toBeNull();
    expect(validateFile(photo, file("big.jpg", "image/jpeg", 5 * MB + 1))).toMatch(/limit is 5 MB/);
    expect(validateFile(video, file("big.mp4", "video/mp4", 101 * MB))).toMatch(/limit is 100 MB/);
    expect(validateFile(MEDIA_KINDS["actor-video"], file("ok.mp4", "video/mp4", 200 * MB))).toBeNull();
    expect(validateFile(MEDIA_KINDS["actor-video"], file("big.mp4", "video/mp4", 251 * MB))).toMatch(/limit is 250 MB/);
  });

  it("uses the same limits as the buckets", () => {
    expect(MEDIA_KINDS["creator-video"].maxBytes).toBe(104857600);
    expect(MEDIA_KINDS["actor-video"].maxBytes).toBe(262144000);
    for (const k of ["creator-headshot", "creator-photo", "creator-location", "actor-headshot", "actor-photo", "location-photo"] as const) {
      expect(MEDIA_KINDS[k].maxBytes).toBe(5242880);
    }
  });

  it("describes what is accepted and sets the file input's accept list", () => {
    expect(limitsText(video)).toBe("MP4 or MOV, up to 100 MB each. Up to 10 videos in all.");
    expect(limitsText(photo)).toBe("JPG, PNG or WebP, up to 5 MB each.");
    expect(acceptFor(video)).toBe("video/mp4,video/quicktime");
  });

  it("splits a batch: good files go through, bad ones are named with a reason", () => {
    const { accepted, rejected } = validateBatch(photo, [file("a.jpg", "image/jpeg"), file("b.gif", "image/gif"), file("c.png", "image/png", 6 * MB), file("d.webp", "image/webp")], 0);
    expect(accepted.map((a) => a.file.name)).toEqual(["a.jpg", "d.webp"]);
    expect(rejected.map((r) => r.name)).toEqual(["b.gif", "c.png"]);
  });

  it("stops at the most one owner may hold, counting the files already there", () => {
    const actorPhoto = MEDIA_KINDS["actor-photo"];
    const batch = Array.from({ length: 5 }, (_, i) => file(`p${i}.jpg`, "image/jpeg"));
    const r = validateBatch(actorPhoto, batch, 6);
    expect(r.accepted.map((a) => a.file.name)).toEqual(["p0.jpg", "p1.jpg"]);
    expect(r.rejected).toHaveLength(3);
    expect(r.rejected[0].reason).toMatch(/room for 8 photos/);
    expect(validateBatch(photo, batch, 500).rejected).toHaveLength(0);
  });
});

describe("paths and positions", () => {
  it("names new files <owner>/<prefix>-<uuid>.<ext> from the checked type, as the old dashboard's copy names them", () => {
    expect(buildPath(MEDIA_KINDS["creator-video"], "c1", "video/quicktime", "u1")).toBe("c1/video-u1.mov");
    expect(buildPath(MEDIA_KINDS["creator-headshot"], "c1", "image/png", "u2")).toBe("c1/headshot-u2.png");
    expect(buildPath(MEDIA_KINDS["location-photo"], "l1", "image/jpeg", "u3")).toBe("l1/photo-u3.jpg");
    expect(buildPath(MEDIA_KINDS["creator-location"], "c1", "image/webp", "u4")).toBe("c1/location-u4.webp");
  });

  it("never gives two files the same path", () => {
    const a = buildPath(MEDIA_KINDS["actor-photo"], "a1", "image/jpeg");
    const b = buildPath(MEDIA_KINDS["actor-photo"], "a1", "image/jpeg");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^a1\/photo-[0-9a-f-]{36}\.jpg$/);
  });

  it("puts a new item after the last one", () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([0, 1, 5])).toBe(6);
  });

  it("makes a main photo first and renumbers only what moved", () => {
    const photos = [{ id: "a", sort_order: 0 }, { id: "b", sort_order: 1 }, { id: "c", sort_order: 2 }];
    expect(mainFirstOrder(photos, "a")).toEqual([]);
    expect(mainFirstOrder(photos, "c")).toEqual([{ id: "c", sort_order: 0 }, { id: "a", sort_order: 1 }, { id: "b", sort_order: 2 }]);
    expect(mainFirstOrder([{ id: "x", sort_order: 0 }, { id: "y", sort_order: 0 }], "y")).toEqual([{ id: "x", sort_order: 1 }]);
    expect(() => mainFirstOrder(photos, "zzz")).toThrow(/no longer on this location/);
  });

  it("formats sizes and names a video from its file name", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * MB)).toBe("3.0 MB");
    expect(formatBytes(120 * MB)).toBe("120 MB");
    expect(titleFromName("My_first-take.mp4")).toBe("My first take");
  });
});

describe("plain error wording", () => {
  const video = MEDIA_KINDS["creator-video"];
  it("says what to do for permission, size, type, limits and network problems", () => {
    expect(mediaErrorText({ code: "42501", message: "x" })).toMatch(/do not have permission/);
    expect(mediaErrorText({ status: 403, message: "new row violates row-level security policy" })).toMatch(/do not have permission/);
    expect(mediaErrorText({ status: 413, message: "Payload too large" }, video)).toMatch(/too large for storage \(the limit is 100 MB\)/);
    expect(mediaErrorText(new Error("mime type video/webm is not supported"), video)).toMatch(/Use MP4 or MOV/);
    expect(mediaErrorText({ code: "23514", message: "creator already has 10 portfolio videos" }, video)).toMatch(/most videos allowed/);
    expect(mediaErrorText({ code: "network", message: "The upload was interrupted." })).toMatch(/Check your connection/);
    expect(mediaErrorText(new Error("Failed to fetch"))).toMatch(/Check your connection/);
    expect(mediaErrorText({ code: "23505", message: "dup" })).toMatch(/Try again/);
  });
  it("falls back to the message it was given", () => {
    expect(mediaErrorText(new Error("Something odd"))).toBe("Something odd");
    expect(mediaErrorText(null)).toBe("Something went wrong. Try again.");
  });
  it("summarizes a queue", () => {
    expect(summarizeQueue([
      { id: "1", name: "a", size: 1, status: "done", progress: 100 },
      { id: "2", name: "b", size: 1, status: "uploading", progress: 5 },
      { id: "3", name: "c", size: 1, status: "failed", progress: 0 },
    ])).toBe("1 uploaded, 1 in progress, 1 failed");
  });
});

describe("missing storage signing secrets", () => {
  const dbMessage = "storage_signing_project_url is not present in vault.secrets";
  it("recognises the database error by code or message", () => {
    expect(isStorageSecretError("F0000", "x")).toBe(true);
    expect(isStorageSecretError(undefined, dbMessage)).toBe(true);
    expect(isStorageSecretError("42501", "You do not have permission")).toBe(false);
    expect(isStorageSecretError(undefined, "failed to copy application headshot (http 400)")).toBe(false);
  });
  it("gives a plain message that names the secrets and says nothing changed, with no value in it", () => {
    const text = storageSecretsText("F0000", dbMessage, "removing the photo files")!;
    expect(text).toMatch(/Media storage is not connected on this site yet/);
    expect(text).toMatch(/removing the photo files could not be done/);
    expect(text).toMatch(/Nothing was changed/);
    expect(text).toMatch(/storage_signing_project_url and storage_signing_service_role_key/);
    expect(text).not.toMatch(/vault\.secrets/);
    expect(storageSecretsText("42501", "no", "x")).toBeNull();
  });
  it("is used when an application with files is approved", () => {
    expect(reviewErrorText("F0000", "storage_signing_service_role_key is not present in vault.secrets")).toMatch(/copying the applicant's files could not be done/);
    expect(reviewErrorText("42501", "x")).toBe("You do not have permission to do that.");
  });
});
