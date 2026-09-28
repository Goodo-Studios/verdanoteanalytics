// Test fixture: the global convention as seeded by
// supabase/migrations/20260927100001_goodo_naming_convention.sql. Keep in sync.

import type { NamingConvention } from "./naming-convention.ts";

export const goodoConvention: NamingConvention = {
  id: "global",
  account_id: null,
  scope: "global",
  separator: "_",
  segments: [
    { position: 0, dimension: "unique_code", required: true, free_text: false },
    { position: 1, dimension: "ad_type", required: false, free_text: false },
    { position: 2, dimension: "person", required: false, free_text: false },
    { position: 3, dimension: "style", required: false, free_text: false },
    { position: 4, dimension: "product", required: false, free_text: true },
    { position: 5, dimension: "hook", required: false, free_text: true },
    { position: 6, dimension: "theme", required: false, free_text: true },
  ],
  vocab: [
    { dimension: "ad_type", canonical: "Video", aliases: ["video", "VID"] },
    { dimension: "ad_type", canonical: "Static", aliases: ["static", "Image", "image", "IMG", "Photo", "photo"] },
    { dimension: "ad_type", canonical: "GIF", aliases: ["gif", "Gif"] },
    { dimension: "ad_type", canonical: "Carousel", aliases: ["carousel"] },
    { dimension: "person", canonical: "Creator", aliases: ["creator"] },
    { dimension: "person", canonical: "Customer", aliases: ["customer"] },
    { dimension: "person", canonical: "Founder", aliases: ["founder"] },
    { dimension: "person", canonical: "Actor", aliases: ["actor"] },
    { dimension: "person", canonical: "NoTalent", aliases: ["No Talent", "No-Talent", "notalent"] },
    { dimension: "style", canonical: "UGCNative", aliases: ["UGC", "ugc", "UGCnative", "UGC-Native", "UGC Native"] },
    { dimension: "style", canonical: "StudioClean", aliases: ["Studio", "studio", "Studio Clean", "Studio-Clean"] },
    { dimension: "style", canonical: "TextForward", aliases: ["Text Forward", "Text-Forward"] },
    { dimension: "style", canonical: "Lifestyle", aliases: ["lifestyle"] },
    { dimension: "style", canonical: "Testimonial", aliases: ["testimonial"] },
    { dimension: "hook", canonical: "Problem", aliases: ["problem"] },
    { dimension: "theme", canonical: "SocialProof", aliases: ["socialproof", "Social-Proof", "Proof"] },
  ],
};
