// Phase 4 reaches today for every window length (audit plan item 6.5, part 3).
//
// The window starts `dailyDays` days before today, so it spans dailyDays + 1 calendar days,
// but the chunk count was ceil(dailyDays / 15). For 15, 30, 60 and 90 days the chunks ended
// yesterday and today's spend was never fetched until the next day's sync.
//
//   deno test -A supabase/functions/sync/phase4-chunks.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SYNC_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");
Deno.env.set("BACKFILL_DAILY_HISTORY_NO_SERVE", "1");

const { phase4Chunks } = await import("./index.ts");

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().split("T")[0];
const now = new Date("2026-11-16T12:00:00Z");

for (const days of [14, 15, 16, 28, 30, 60, 90]) {
  Deno.test(`a ${days}-day window covers every day from the start through today, with no gaps`, () => {
    const since = iso(new Date(now.getTime() - days * DAY));
    const chunks = phase4Chunks(days, since, now, 15);
    assertEquals(chunks[0].since, since);
    assertEquals(chunks[chunks.length - 1].until, "2026-11-16", "the last chunk must end today");
    for (let i = 1; i < chunks.length; i++) {
      const prevUntil = new Date(chunks[i - 1].until + "T00:00:00Z").getTime();
      assertEquals(new Date(chunks[i].since + "T00:00:00Z").getTime(), prevUntil + DAY, "chunks must be contiguous");
    }
    for (const c of chunks) {
      const span = (new Date(c.until + "T00:00:00Z").getTime() - new Date(c.since + "T00:00:00Z").getTime()) / DAY + 1;
      assert(span >= 1 && span <= 15, `chunk ${c.since}..${c.until} is ${span} days`);
    }
  });
}
