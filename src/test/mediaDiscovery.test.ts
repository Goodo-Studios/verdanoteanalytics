// Regression coverage for the Ad Preview API src extractors in
// supabase/functions/_shared/media-discovery.ts.
//
// Root bug: discoverImageUrl's Strategy 5 filtered preview-HTML `src` values with
// `url.includes("fbcdn") || url.includes("facebook")`. The `facebook` clause matched
// facebook.com PAGE URLs, which return text/html — those got cached as <adId>.jpg
// garbage (~45% of one account). The fix restricts to *.fbcdn.net media hosts only.
// These tests pin that behavior so the loose filter can't come back.
import { describe, it, expect } from "vitest";
import {
  extractPreviewImageSrc,
  extractPreviewVideoSrc,
} from "../../supabase/functions/_shared/media-discovery.ts";

const IMG = "https://scontent.xx.fbcdn.net/v/t45.1600-4/abc123_n.jpg?_nc_cat=1";
const IMG2 = "https://external.xx.fbcdn.net/emg1/def456_n.png?stp=dst-jpg";
const VIDEO = "https://video.xx.fbcdn.net/v/t42.1790-2/ghi789.mp4?efg=1";
const PAGE = "https://www.facebook.com/123456789/posts/987654321";
const PAGE2 = "https://web.facebook.com/business/ads";

describe("extractPreviewImageSrc", () => {
  it("returns null for empty / missing body", () => {
    expect(extractPreviewImageSrc("")).toBeNull();
    // @ts-expect-error guarding the runtime null path
    expect(extractPreviewImageSrc(undefined)).toBeNull();
  });

  it("NEVER returns a facebook.com page URL (the garbage-thumbnail root cause)", () => {
    const html = `<div><a src="${PAGE}"></a><iframe src="${PAGE2}"></iframe></div>`;
    expect(extractPreviewImageSrc(html)).toBeNull();
  });

  it("returns an fbcdn image when present", () => {
    const html = `<img src="${IMG}" />`;
    expect(extractPreviewImageSrc(html)).toBe(IMG);
  });

  it("ignores a page URL even when a real fbcdn image is also present", () => {
    const html = `<a src="${PAGE}"></a><img src="${IMG}" />`;
    expect(extractPreviewImageSrc(html)).toBe(IMG);
  });

  it("picks the LAST fbcdn image (main creative, not the profile pic)", () => {
    const profile = "https://scontent.xx.fbcdn.net/v/t1.0/profilepic_n.jpg";
    const html = `<img src="${profile}" /><img src="${IMG2}" />`;
    expect(extractPreviewImageSrc(html)).toBe(IMG2);
  });

  it("never returns a video stream as an image", () => {
    const html = `<video src="${VIDEO}"></video>`;
    expect(extractPreviewImageSrc(html)).toBeNull();
  });

  it("decodes &amp; entities in the matched URL", () => {
    const html = `<img src="https://scontent.xx.fbcdn.net/v/x_n.jpg?a=1&amp;b=2" />`;
    expect(extractPreviewImageSrc(html)).toBe(
      "https://scontent.xx.fbcdn.net/v/x_n.jpg?a=1&b=2"
    );
  });
});

describe("extractPreviewVideoSrc", () => {
  it("returns null for empty body", () => {
    expect(extractPreviewVideoSrc("")).toBeNull();
  });

  it("NEVER returns a facebook.com page URL", () => {
    const html = `<a src="${PAGE}"></a><iframe src="https://www.facebook.com/watch/videos/1"></iframe>`;
    expect(extractPreviewVideoSrc(html)).toBeNull();
  });

  it("returns an fbcdn .mp4 video src", () => {
    const html = `<video src="${VIDEO}"></video>`;
    expect(extractPreviewVideoSrc(html)).toBe(VIDEO);
  });

  it("skips _n.jpg / _n.png thumbnail stills", () => {
    const html = `<img src="${IMG}" /><img src="${IMG2}" />`;
    expect(extractPreviewVideoSrc(html)).toBeNull();
  });

  it("returns the first qualifying video when several are present", () => {
    const v2 = "https://video.xx.fbcdn.net/v/t42/second.mp4";
    const html = `<video src="${VIDEO}"></video><video src="${v2}"></video>`;
    expect(extractPreviewVideoSrc(html)).toBe(VIDEO);
  });
});
