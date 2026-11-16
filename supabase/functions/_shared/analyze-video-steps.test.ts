// Audit 8.6 part 2: the analyze-creative video path.
//   * spend is reported after every paid call, so a later timeout or error does not lose it
//     (the per-account spending cap only ever saw successful items);
//   * the raw transcript is saved before any AI call, so a retry does not pay to transcribe again;
//   * a video with no speech skips the clean, brand, script and visual calls, and is remembered
//     as no_speech so a retry does not transcribe it again either.
//   deno test -A supabase/functions/_shared/analyze-video-steps.test.ts

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { analyzeVideo, type VideoStepDeps } from "./analyze-video-steps.ts";

const MODELS = { text: "text-model", vision: "vision-model" };

function harness(opts: {
  transcript?: { text: string | null; costUsd: number };
  failOnSystem?: string;
} = {}) {
  const log: string[] = [];
  const spend: number[] = [];
  const deps: VideoStepDeps = {
    transcribe: (_url) => {
      log.push("transcribe");
      return Promise.resolve(opts.transcript ?? { text: "raw words", costUsd: 0.01 });
    },
    chat: (model, system) => {
      log.push(`chat:${model}:${system}`);
      if (opts.failOnSystem && system === opts.failOnSystem) return Promise.reject(new Error("provider down"));
      return Promise.resolve({ text: system === "CLEAN" ? "clean words" : "{}", costUsd: 0.1 });
    },
    fetchImageAsDataUrl: () => Promise.resolve(null),
    frameAnalysis: () => {
      log.push("frames");
      return Promise.resolve({ notes: "", costUsd: 0.2, hadFrames: false });
    },
    onSpend: (usd) => {
      log.push(`spend:${usd}`);
      spend.push(usd);
      return Promise.resolve();
    },
    saveTranscript: (text) => {
      log.push(`save:${text}`);
      return Promise.resolve();
    },
  };
  return { deps, log, spend };
}

const PROMPTS = {
  clean: "CLEAN",
  framework: "FRAMEWORK",
  brand: "BRAND",
  script: "SCRIPT",
  visual: "VISUAL",
  frameSystem: "FRAMES",
};

const creative = { transcript: null, transcript_status: "none", video_url: "https://cdn/video.mp4" };
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 1000) / 1000;

Deno.test("8.6: reports spend after each paid call and the total matches", async () => {
  const { deps, spend } = harness();
  const out = await analyzeVideo(creative, null, MODELS, PROMPTS, deps);
  // transcribe 0.01 + clean, framework, brand, script, visual 0.1 each + frames 0.2
  assertEquals(sum(spend), 0.71);
  assertEquals(Math.round(out.costUsd * 1000) / 1000, 0.71);
});

Deno.test("8.6: spend already made is reported when a later call fails", async () => {
  const { deps, spend } = harness({ failOnSystem: "BRAND" });
  await assertRejects(() => analyzeVideo(creative, null, MODELS, PROMPTS, deps));
  // transcribe, clean and framework were paid before the brand call failed
  assert(sum(spend) >= 0.21, `expected at least 0.21 recorded, got ${sum(spend)}`);
});

Deno.test("8.6: the raw transcript is saved before any AI call", async () => {
  const { deps, log } = harness();
  await analyzeVideo(creative, null, MODELS, PROMPTS, deps);
  const saveAt = log.indexOf("save:raw words");
  const firstChat = log.findIndex((l) => l.startsWith("chat:"));
  assert(saveAt >= 0, "transcript was not saved");
  assert(saveAt < firstChat, `saved at ${saveAt}, first AI call at ${firstChat}`);
});

Deno.test("8.6: a stored transcript is reused, not paid for again", async () => {
  const { deps, log } = harness();
  await analyzeVideo({ ...creative, transcript: "already have it" }, null, MODELS, PROMPTS, deps);
  assertEquals(log.includes("transcribe"), false);
});

Deno.test("8.6: no speech skips clean, brand, script and visual, and is remembered", async () => {
  const { deps, log } = harness({ transcript: { text: null, costUsd: 0.01 } });
  const out = await analyzeVideo(creative, null, MODELS, PROMPTS, deps);
  for (const p of ["CLEAN", "BRAND", "SCRIPT", "VISUAL"]) {
    assertEquals(log.some((l) => l.endsWith(`:${p}`)), false, `${p} should be skipped`);
  }
  assert(log.includes("save:null"), "no-speech result was not saved");
  assertEquals(out.update.transcript_status, "no_speech");
});

Deno.test("8.6: a video already known to have no speech is not transcribed again", async () => {
  const { deps, log } = harness();
  const out = await analyzeVideo({ ...creative, transcript_status: "no_speech" }, null, MODELS, PROMPTS, deps);
  assertEquals(log.includes("transcribe"), false);
  assertEquals(log.some((l) => l.endsWith(":BRAND")), false);
  assertEquals(out.update.transcript_status, "no_speech");
});

Deno.test("8.6: a failed transcription is not recorded as no speech", async () => {
  const { deps, log } = harness({ transcript: { text: null, costUsd: 0 } });
  const out = await analyzeVideo(creative, null, MODELS, PROMPTS, deps);
  assertEquals(log.some((l) => l.startsWith("save:")), false);
  assertEquals(out.update.transcript_status, "none");
});
