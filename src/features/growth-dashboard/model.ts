// Growth Dashboard model: the data shapes and the calculations of the old Growth
// Dashboard (repos/private/goodo-growth-dashboard/index.html), ported as plain
// functions so the page and the tests share one copy.
//
// What moved where:
//   * The numbers the old page kept in localStorage (key `goodo3m_v1`) keep the same
//     shape (GrowthState) and are stored in the `growth_dashboard_data` row `state`.
//   * The plan figures the old page had written into its source (H1 actuals, the
//     Jul to Dec plan, the goal) are stored in the row `plan` (GrowthPlan). They are
//     not in this file, so no revenue figure ships in the page bundle that clients
//     also download.

/** localStorage key of the old app. */
export const OLD_STORAGE_KEY = "goodo3m_v1";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Full month name for a month index, e.g. 10 -> "November". */
export const monthName = (m: number): string => new Date(2000, m, 1).toLocaleString("en-US", { month: "long" });
/** Month indexes (JS getMonth) of the second half, the part the plan covers. */
export const H2_MONTHS = [6, 7, 8, 9, 10, 11];

export type ActDef = { k: string; n: string; t: number };

/** Output channels and their default weekly targets, as in the old app. */
export const ACTS: ActDef[] = [
  { k: "liPosts", n: "LinkedIn posts", t: 5 },
  { k: "twPosts", n: "Twitter / X posts", t: 5 },
  { k: "igtt", n: "Instagram / TikTok videos", t: 4 },
  { k: "liConnect", n: "LinkedIn connection requests", t: 200 },
  { k: "liDM", n: "LinkedIn direct messages", t: 10 },
  { k: "warm", n: "Warm DMs / messages", t: 25 },
  { k: "community", n: "Community touches", t: 10 },
  { k: "referral", n: "Referral asks", t: 5 },
  { k: "newsletter", n: "Newsletter", t: 1 },
  { k: "youtube", n: "YouTube video", t: 1 },
  { k: "podcast", n: "Podcast episode", t: 0 },
];
const ACT_KEYS = new Set(ACTS.map((a) => a.k));

export const QUOTES = [
  "Discipline is choosing between what you want now and what you want most.",
  "You don't have to be extreme, just consistent.",
  "The work you do when no one's watching is the work that wins.",
  "Small hinges swing big doors: one more rep, one more call.",
  "Momentum is built one logged day at a time.",
  "Pressure is a privilege. Go earn it.",
  "Dream big. Start small. Act now.",
  "Your future is created by what you do today, not tomorrow.",
  "Fall in love with the process and the results take care of themselves.",
  "Hard work beats talent when talent doesn't work hard.",
  "Every expert was once a beginner who didn't stop.",
  "Show up. Do the reps. Rack up the numbers.",
  "The grind you resist is the growth you need.",
  "Be so good they can't ignore you.",
  "Stay hungry. Stay consistent. Push to the limit.",
  "Success is the sum of small efforts repeated day in and day out.",
  "Don't count the days, make the days count.",
  "What gets measured gets managed. What gets logged gets done.",
];

export type WeekEntry = {
  total: number | null;
  paid: number | null;
  spend: number | null;
  acts: Record<string, number>;
};
export type Deal = { id: string; date: string; client: string; price: number };

/** Same shape as the old app's localStorage object. */
export type GrowthState = {
  /** Month index "6".."11" to actual revenue in dollars. */
  rev: Record<string, number>;
  /** Friday date (YYYY-MM-DD) of each week to that week's channel counts. */
  weeks: Record<string, WeekEntry>;
  /** Channel key to weekly target. */
  targets: Record<string, number>;
  /** Day (YYYY-MM-DD) to calls booked. */
  calls: Record<string, number>;
  deals: Deal[];
};

export type PlanMonth = {
  rev: number;
  calls: number;
  signings: number;
  active: number;
  newMrr: number;
  base: number;
  projects: number;
};

export type GrowthPlan = {
  year: number;
  goal: number;
  /** Actual revenue per month, January to June. */
  h1Actuals: number[];
  /** Plan per month, July to December. */
  months: PlanMonth[];
  assumptions: string;
  /** Weeks with a Friday before this date are not judged against targets ("" for none). */
  targetsFrom: string;
};

// ---------------------------------------------------------------- helpers

export const emptyWeek = (): WeekEntry => ({ total: null, paid: null, spend: null, acts: {} });

export function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
export function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseISO(s: string): Date {
  const p = s.split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}
/** The Friday on or after a date (the old app keys each week by its Friday). */
export function fridayOf(d: Date): Date {
  const x = new Date(d);
  const diff = (5 - x.getDay() + 7) % 7;
  x.setDate(x.getDate() + diff);
  return x;
}
export function fmtMoney(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${Math.round(a / 1e3)}k`;
  return `${s}$${Math.round(a)}`;
}

export type Status = "good" | "warn" | "crit" | "na";
export function status(actual: number | null | undefined, target: number | null | undefined): Status {
  if (!target || target <= 0) return "na";
  if (actual == null) return "na";
  if (actual >= target) return "good";
  if (actual >= 0.6 * target) return "warn";
  return "crit";
}

/** A fresh state with the default targets, like the old app's first load. */
export function emptyState(): GrowthState {
  return withDefaults({});
}

/** Fill missing parts and default targets, as the old app's load() did. */
export function withDefaults(s: Partial<GrowthState> | null | undefined): GrowthState {
  const src = s ?? {};
  const targets: Record<string, number> = { ...(src.targets ?? {}) };
  for (const a of ACTS) if (targets[a.k] == null) targets[a.k] = a.t;
  return {
    rev: { ...(src.rev ?? {}) },
    weeks: { ...(src.weeks ?? {}) },
    targets,
    calls: { ...(src.calls ?? {}) },
    deals: [...(src.deals ?? [])],
  };
}

// ---------------------------------------------------------------- plan

export function emptyPlan(year: number): GrowthPlan {
  return {
    year,
    goal: 0,
    h1Actuals: [0, 0, 0, 0, 0, 0],
    months: H2_MONTHS.map(() => ({ rev: 0, calls: 0, signings: 0, active: 0, newMrr: 0, base: 0, projects: 0 })),
    assumptions: "",
    targetsFrom: "",
  };
}

export function planMonth(plan: GrowthPlan | null, m: number): PlanMonth | null {
  if (!plan || m < 6 || m > 11) return null;
  return plan.months[m - 6] ?? null;
}

/** Cumulative actuals January to June (the old H1_CUM). */
export function h1Cumulative(plan: GrowthPlan | null): number[] {
  const out: number[] = [];
  let run = 0;
  for (let i = 0; i < 6; i++) {
    run += plan?.h1Actuals[i] ?? 0;
    out.push(run);
  }
  return out;
}
export function h1End(plan: GrowthPlan | null): number {
  return h1Cumulative(plan)[5];
}
/** Cumulative plan July to December, starting from the end of June (the old PLAN_CUM). */
export function planCumulative(plan: GrowthPlan | null): number[] {
  const out: number[] = [];
  let run = h1End(plan);
  for (let i = 0; i < 6; i++) {
    run += plan?.months[i]?.rev ?? 0;
    out.push(run);
  }
  return out;
}

export type PlanSummary = {
  goal: number;
  projectedFinish: number;
  exitRunRate: number;
  clientsToSign: number;
  activeByDec: number;
  h2Revenue: number;
  firstSignings: number;
  lastSignings: number;
};
export function planSummary(plan: GrowthPlan): PlanSummary {
  const h2Revenue = plan.months.reduce((a, m) => a + m.rev, 0);
  return {
    goal: plan.goal,
    projectedFinish: h1End(plan) + h2Revenue,
    exitRunRate: plan.months[5]?.rev ?? 0,
    clientsToSign: plan.months.reduce((a, m) => a + m.signings, 0),
    activeByDec: plan.months[5]?.active ?? 0,
    h2Revenue,
    firstSignings: plan.months[0]?.signings ?? 0,
    lastSignings: plan.months[5]?.signings ?? 0,
  };
}

// ---------------------------------------------------------------- revenue chart

export type RevPoint = { month: string; goal: number | null; plan: number | null; actual: number | null; entered: number | null };

/** Chart rows for "Revenue vs. plan" (with entered actuals) and the Plan tab chart (without). */
export function revenueSeries(state: GrowthState, plan: GrowthPlan | null, withEntered: boolean): RevPoint[] {
  const h1 = h1Cumulative(plan);
  const end = h1[5];
  const planCum = planCumulative(plan);
  const entered: (number | null)[] = [null, null, null, null, null, end];
  let run = end;
  let broke = false;
  for (const m of H2_MONTHS) {
    const v = state.rev[m];
    if (v != null && !broke) {
      run += +v;
      entered.push(run);
    } else {
      broke = true;
      entered.push(null);
    }
  }
  return MONTHS.map((month, i) => ({
    month,
    goal: plan ? plan.goal : null,
    plan: plan ? (i < 5 ? null : i === 5 ? end : planCum[i - 6]) : null,
    actual: plan && i < 6 ? h1[i] : null,
    entered: withEntered && plan ? entered[i] : null,
  }));
}

// ---------------------------------------------------------------- KPIs (Progress tab)

/** The old app clamps "this month" into July to December. */
export function clampH2(m: number): number {
  return m < 6 ? 6 : m > 11 ? 11 : m;
}

export function sortedWeekKeys(state: GrowthState): string[] {
  return Object.keys(state.weeks)
    .filter((k) => {
      const w = state.weeks[k];
      return w && (w.total != null || w.paid != null || Object.keys(w.acts || {}).length > 0);
    })
    .sort();
}

export type Kpis = {
  yearProj: number;
  gap: number;
  mCalls: number;
  wkCalls: number;
  mTarget: number | null;
  mName: string;
  dealsMo: number;
  mrrMo: number;
  signTgt: number | null;
  adh: number;
  hit: number;
  appl: number;
};

export function computeKpis(state: GrowthState, plan: GrowthPlan | null, now: Date): Kpis {
  // Year projection: H1 + entered H2 + each missing month at the last entered value
  // (falling back to the plan), exactly as the old app.
  let lastVal: number | null = null;
  for (const m of H2_MONTHS) if (state.rev[m] != null) lastVal = +state.rev[m];
  let h2 = 0;
  for (const m of H2_MONTHS) {
    if (state.rev[m] != null) h2 += +state.rev[m];
    else h2 += lastVal != null ? lastVal : planMonth(plan, m)?.rev ?? 0;
  }
  const yearProj = h1End(plan) + h2;

  const mNow = clampH2(now.getMonth());
  let mCalls = 0;
  let wkCalls = 0;
  const wkAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  for (const dk of Object.keys(state.calls)) {
    const d = parseISO(dk);
    const v = +state.calls[dk] || 0;
    if (d.getMonth() === mNow) mCalls += v;
    if (d >= wkAgo && d <= now) wkCalls += v;
  }
  const pm = planMonth(plan, mNow);

  let dealsMo = 0;
  let mrrMo = 0;
  for (const d of state.deals) {
    if (parseISO(d.date).getMonth() === mNow) {
      dealsMo++;
      mrrMo += +d.price || 0;
    }
  }

  const wk = state.weeks[iso(fridayOf(now))];
  let hit = 0;
  let appl = 0;
  for (const a of ACTS) {
    const t = +state.targets[a.k];
    if (t > 0) {
      appl++;
      const v = wk && wk.acts ? wk.acts[a.k] : null;
      if (v != null && v >= t) hit++;
    }
  }
  const adh = appl ? Math.round((hit / appl) * 100) : 0;

  return {
    yearProj,
    gap: (plan?.goal ?? 0) - yearProj,
    mCalls,
    wkCalls,
    mTarget: pm ? pm.calls : null,
    mName: MONTHS[mNow],
    dealsMo,
    mrrMo,
    signTgt: pm ? pm.signings : null,
    adh,
    hit,
    appl,
  };
}

export type Tile = { cls: "s-good" | "s-warn" | "s-crit" | "s-accent"; label: string; value: string; foot: string };

export function progressTiles(k: Kpis, plan: GrowthPlan | null): Tile[] {
  const goal = plan?.goal ?? 0;
  const goalCls = !plan ? "s-accent" : k.yearProj >= goal ? "s-good" : k.yearProj >= goal * 0.9 ? "s-warn" : "s-accent";
  const gapCls = k.gap <= 0 ? "s-good" : "s-warn";
  const callCls =
    k.mTarget == null ? "s-accent" : k.mCalls >= k.mTarget ? "s-good" : k.mCalls >= k.mTarget * 0.6 ? "s-warn" : "s-crit";
  const adhCls = k.adh >= 80 ? "s-good" : k.adh >= 50 ? "s-warn" : "s-crit";
  const dealCls =
    k.signTgt == null ? "s-accent" : k.dealsMo >= k.signTgt ? "s-good" : k.dealsMo >= 0.6 * k.signTgt ? "s-warn" : "s-crit";
  const goalText = plan ? fmtMoney(goal) : "not set";
  return [
    { cls: goalCls, label: "Full-year pace", value: fmtMoney(k.yearProj), foot: `goal ${goalText}` },
    {
      cls: plan ? gapCls : "s-accent",
      label: !plan ? "Gap to goal" : k.gap <= 0 ? "Over goal by" : `Gap to ${fmtMoney(goal)}`,
      value: plan ? fmtMoney(Math.abs(k.gap)) : "-",
      foot: !plan ? "enter the plan first" : k.gap <= 0 ? "ahead of plan" : "still to close",
    },
    { cls: callCls, label: `${k.mName} calls`, value: `${k.mCalls} / ${k.mTarget ?? "-"}`, foot: "booked this month" },
    {
      cls: dealCls,
      label: `${k.mName} deals`,
      value: `${k.dealsMo}${k.signTgt != null ? ` / ${k.signTgt}` : ""}`,
      foot: "closed this month",
    },
    { cls: "s-accent", label: "MRR added", value: `${fmtMoney(k.mrrMo)}/mo`, foot: "this month" },
    { cls: "s-accent", label: "Calls this week", value: `${k.wkCalls}`, foot: "last 7 days" },
    { cls: adhCls, label: "Activity adherence", value: `${k.adh}%`, foot: `${k.hit} of ${k.appl} targets this wk` },
  ];
}

// ---------------------------------------------------------------- calls calendar

export function monthCallTotal(state: GrowthState, y: number, m: number): number {
  let s = 0;
  for (const dk of Object.keys(state.calls)) {
    const d = parseISO(dk);
    if (d.getFullYear() === y && d.getMonth() === m) s += +state.calls[dk] || 0;
  }
  return s;
}

export type Pill = { cls: Status; text: string } | null;

/** Pill next to the month's call tally: target hit, on track, behind or upcoming. */
export function callTallyPill(total: number, target: number | null, y: number, m: number, now: Date): Pill {
  if (!target) return null;
  const dim = new Date(y, m + 1, 0).getDate();
  const elapsed =
    now.getFullYear() === y && now.getMonth() === m
      ? now.getDate()
      : new Date(y, m, 1) < new Date(now.getFullYear(), now.getMonth(), 1)
        ? dim
        : 0;
  if (total >= target) return { cls: "good", text: "target hit" };
  if (elapsed === 0) return { cls: "na", text: "upcoming" };
  const exp = (target * elapsed) / dim;
  if (total >= exp) return { cls: "good", text: "on track" };
  return { cls: total >= 0.6 * exp ? "warn" : "crit", text: "behind" };
}

export type CalendarCell = { key: string; day: number; weekend: boolean } | null;

/** Calendar grid for a month, weeks starting Monday. Leading nulls are blank cells. */
export function calendarCells(y: number, m: number): CalendarCell[] {
  const startDow = (new Date(y, m, 1).getDay() + 6) % 7;
  const dim = new Date(y, m + 1, 0).getDate();
  const cells: CalendarCell[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let day = 1; day <= dim; day++) {
    const dow = new Date(y, m, day).getDay();
    cells.push({ key: `${y}-${pad(m + 1)}-${pad(day)}`, day, weekend: dow === 0 || dow === 6 });
  }
  return cells;
}

// ---------------------------------------------------------------- deals

export type DealTally = { month: string; count: number; target: number | null; value: number; allValue: number; pill: Pill };

export function dealTally(state: GrowthState, plan: GrowthPlan | null, now: Date): DealTally {
  const y = now.getFullYear();
  const m = now.getMonth();
  const mm = clampH2(m);
  const md = state.deals.filter((d) => parseISO(d.date).getMonth() === mm);
  const count = md.length;
  const value = md.reduce((a, d) => a + (+d.price || 0), 0);
  const allValue = state.deals.reduce((a, d) => a + (+d.price || 0), 0);
  const target = planMonth(plan, mm)?.signings ?? null;
  const dim = new Date(y, mm + 1, 0).getDate();
  const elapsed = m === mm ? now.getDate() : dim;
  let pill: Pill = null;
  if (target) {
    if (count >= target) pill = { cls: "good", text: "target hit" };
    else {
      const exp = (target * elapsed) / dim;
      pill = count >= exp ? { cls: "good", text: "on track" } : { cls: count >= 0.6 * exp ? "warn" : "crit", text: "behind" };
    }
  }
  return { month: MONTHS[mm], count, target, value, allValue, pill };
}

export function sortedDeals(state: GrowthState): Deal[] {
  return state.deals.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function newDealId(now: Date = new Date()): string {
  return `${now.getTime()}-${Math.floor(Math.random() * 1000)}`;
}

// ---------------------------------------------------------------- outputs

export function targetSum(state: GrowthState): number {
  let s = 0;
  for (const a of ACTS) {
    const t = +state.targets[a.k];
    if (t > 0) s += t;
  }
  return s;
}
export function weekActs(state: GrowthState, k: string): number {
  const w = state.weeks[k];
  let s = 0;
  if (w && w.acts) for (const a of ACTS) if (w.acts[a.k] != null) s += +w.acts[a.k];
  return s;
}
export function channelTotal(state: GrowthState, k: string): number {
  let s = 0;
  for (const wk of Object.keys(state.weeks)) {
    const w = state.weeks[wk];
    if (w && w.acts && w.acts[k] != null) s += +w.acts[k];
  }
  return s;
}
export function allTimeTotal(state: GrowthState): number {
  return Object.keys(state.weeks).reduce((a, k) => a + weekActs(state, k), 0);
}
/** Number of week Fridays that fall in month m between July and December of the plan year. */
export function weeksInMonth(m: number, year: number): number {
  let c = 0;
  let g = 0;
  let d = fridayOf(new Date(year, 6, 1));
  const end = new Date(year, 11, 31);
  while (d <= end && g < 60) {
    if (d.getMonth() === m) c++;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
    g++;
  }
  return c;
}
export function monthOut(state: GrowthState, m: number): number {
  return Object.keys(state.weeks).reduce((a, k) => (parseISO(k).getMonth() === m ? a + weekActs(state, k) : a), 0);
}
/** Week columns of the spreadsheet: every Friday from the first week of July to this week or the last logged week. */
export function sheetWeeks(state: GrowthState, now: Date, year: number): string[] {
  const start = fridayOf(new Date(year, 6, 1));
  let last = fridayOf(now);
  const lg = sortedWeekKeys(state);
  if (lg.length) {
    const lw = parseISO(lg[lg.length - 1]);
    if (lw > last) last = lw;
  }
  if (last < start) last = start;
  const out: string[] = [];
  let g = 0;
  let d = new Date(start);
  while (d <= last && g < 60) {
    out.push(iso(d));
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
    g++;
  }
  return out;
}
/** "Jul 6" and "12" (or "Aug 2" when the week crosses a month) for a week keyed by its Friday. */
export function weekRange(key: string): [string, string] {
  const f = parseISO(key);
  const mon = new Date(f.getFullYear(), f.getMonth(), f.getDate() - 4);
  const sun = new Date(f.getFullYear(), f.getMonth(), f.getDate() + 2);
  const a = `${MONTHS[mon.getMonth()]} ${mon.getDate()}`;
  const b = mon.getMonth() === sun.getMonth() ? `${sun.getDate()}` : `${MONTHS[sun.getMonth()]} ${sun.getDate()}`;
  return [a, b];
}
export function weekExempt(k: string, plan: GrowthPlan | null): boolean {
  return !!plan?.targetsFrom && k < plan.targetsFrom;
}
export function cellStatus(v: number | null | undefined, target: number): Status | null {
  if (v == null) return null;
  return status(+v, target);
}
/** Colour of a weekly total against the summed target. */
export function weekTotalStatus(v: number, ts: number): Status {
  return v >= ts ? "good" : v >= 0.6 * ts ? "warn" : "crit";
}

export function scoreTiles(state: GrowthState, plan: GrowthPlan | null): Tile[] {
  const keys = sortedWeekKeys(state);
  const ts = targetSum(state);
  const allTime = allTimeTotal(state);
  const best = keys.reduce((m, k) => Math.max(m, weekActs(state, k)), 0);
  let streak = 0;
  for (let i = keys.length - 1; i >= 0; i--) {
    if (weekExempt(keys[i], plan)) continue;
    if (weekActs(state, keys[i]) >= 0.8 * ts) streak++;
    else break;
  }
  const thisW = keys.length ? weekActs(state, keys[keys.length - 1]) : 0;
  const lastW = keys.length > 1 ? weekActs(state, keys[keys.length - 2]) : null;
  const delta = lastW == null ? null : thisW - lastW;
  const deltaTxt =
    delta == null
      ? "log your first week"
      : delta > 0
        ? `▲ ${delta} vs last week`
        : delta < 0
          ? `▼ ${Math.abs(delta)} vs last week`
          : "even with last week";
  return [
    { cls: "s-accent", label: "Outputs racked up", value: allTime.toLocaleString(), foot: "all-time total" },
    { cls: streak >= 1 ? "s-good" : "s-accent", label: "Streak", value: `${streak} wk${streak === 1 ? "" : "s"}`, foot: "weeks at 80%+ of target" },
    { cls: "s-accent", label: "Best week", value: best.toLocaleString(), foot: "personal record" },
    {
      cls: delta == null ? "s-accent" : delta >= 0 ? "s-good" : "s-crit",
      label: "Latest week",
      value: thisW.toLocaleString(),
      foot: deltaTxt,
    },
  ];
}

// ---------------------------------------------------------------- import and validation

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_IMPORT_CHARS = 2_000_000;

function isValidDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = parseISO(s);
  return iso(d) === s;
}
function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type ImportSummary = { revMonths: number; callDays: number; deals: number; weeks: number };
export type ImportResult =
  | { ok: true; state: GrowthState; summary: ImportSummary; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * Validate the JSON exported from the old app's localStorage (key goodo3m_v1) and turn
 * it into a GrowthState. Accepts the raw object, or that object encoded once more as a
 * JSON string. Rejects anything that is not the old app's shape; never guesses numbers.
 */
export function parseGrowthImport(text: string): ImportResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, errors: ["Paste the exported JSON or choose the file first."] };
  if (trimmed.length > MAX_IMPORT_CHARS) return { ok: false, errors: ["File too large for an export."] };

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
    if (typeof raw === "string") raw = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["That is not valid JSON."] };
  }
  const r = validateState(raw);
  if (!r.ok) return r;
  const { summary } = r;
  if (summary.revMonths + summary.callDays + summary.deals + summary.weeks === 0) {
    return { ok: false, errors: ["No numbers found, nothing to import."] };
  }
  return r;
}

/** Validate an object in the old app's shape. Unlike the import, an empty state is fine. */
export function validateState(raw: unknown): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["Expected a JSON object."] };

  const known = new Set(["rev", "weeks", "targets", "calls", "deals"]);
  const unknownTop = Object.keys(raw).filter((k) => !known.has(k));
  if (unknownTop.length) warnings.push(`Ignored unknown fields: ${unknownTop.join(", ")}.`);

  const state: GrowthState = { rev: {}, weeks: {}, targets: {}, calls: {}, deals: [] };

  // rev: month index 6..11 to dollars
  if (raw.rev != null) {
    if (!isObj(raw.rev)) errors.push("rev must be an object.");
    else
      for (const [k, v] of Object.entries(raw.rev)) {
        if (!["6", "7", "8", "9", "10", "11"].includes(k)) errors.push(`rev has an unknown month "${k}" (expected 6 to 11).`);
        else if (v === null) continue;
        else if (!isNum(v)) errors.push(`rev for ${MONTHS[+k]} is not a number.`);
        else state.rev[k] = v;
      }
  }

  // calls: day to count
  if (raw.calls != null) {
    if (!isObj(raw.calls)) errors.push("calls must be an object.");
    else
      for (const [k, v] of Object.entries(raw.calls)) {
        if (!isValidDate(k)) errors.push(`calls has an invalid date "${k}".`);
        else if (v === null) continue;
        else if (!isNum(v) || v < 0) errors.push(`calls on ${k} is not a count.`);
        else state.calls[k] = v;
      }
  }

  // deals: list of {id, date, client, price}
  if (raw.deals != null) {
    if (!Array.isArray(raw.deals)) errors.push("deals must be a list.");
    else
      raw.deals.forEach((d, i) => {
        const n = i + 1;
        if (!isObj(d)) return void errors.push(`deal ${n} is not an object.`);
        if (!isValidDate(d.date)) return void errors.push(`deal ${n} has an invalid date.`);
        if (!isNum(d.price) || d.price < 0) return void errors.push(`deal ${n} has no valid monthly price.`);
        if (d.client != null && typeof d.client !== "string") return void errors.push(`deal ${n} client is not text.`);
        const id = typeof d.id === "string" || isNum(d.id) ? String(d.id) : `import-${n}`;
        state.deals.push({ id, date: d.date, client: (d.client as string | undefined) ?? "", price: d.price });
      });
    const ids = new Set<string>();
    for (const d of state.deals) {
      if (ids.has(d.id)) d.id = `${d.id}-${ids.size}`;
      ids.add(d.id);
    }
  }

  // weeks: Friday to {total, paid, spend, acts}
  const unknownActs = new Set<string>();
  if (raw.weeks != null) {
    if (!isObj(raw.weeks)) errors.push("weeks must be an object.");
    else
      for (const [k, w] of Object.entries(raw.weeks)) {
        if (!isValidDate(k)) {
          errors.push(`weeks has an invalid date "${k}".`);
          continue;
        }
        if (!isObj(w)) {
          errors.push(`week ${k} is not an object.`);
          continue;
        }
        const entry = emptyWeek();
        for (const f of ["total", "paid", "spend"] as const) {
          const v = w[f];
          if (v == null) continue;
          if (!isNum(v)) errors.push(`week ${k} has a ${f} that is not a number.`);
          else entry[f] = v;
        }
        if (w.acts != null) {
          if (!isObj(w.acts)) errors.push(`week ${k} acts is not an object.`);
          else
            for (const [ak, av] of Object.entries(w.acts)) {
              if (av === null) continue;
              if (!isNum(av) || av < 0) errors.push(`week ${k} count for ${ak} is not a number.`);
              else {
                if (!ACT_KEYS.has(ak)) unknownActs.add(ak);
                entry.acts[ak] = av;
              }
            }
        }
        state.weeks[k] = entry;
      }
  }
  if (unknownActs.size) warnings.push(`Kept counts for unknown channels: ${[...unknownActs].join(", ")}.`);

  // targets: channel to weekly target
  if (raw.targets != null) {
    if (!isObj(raw.targets)) errors.push("targets must be an object.");
    else
      for (const [k, v] of Object.entries(raw.targets)) {
        if (v === null) continue;
        if (!ACT_KEYS.has(k)) {
          warnings.push(`Ignored a target for an unknown channel "${k}".`);
          continue;
        }
        if (!isNum(v) || v < 0) errors.push(`target for ${k} is not a number.`);
        else state.targets[k] = v;
      }
  }

  if (errors.length) return { ok: false, errors };

  const summary: ImportSummary = {
    revMonths: Object.keys(state.rev).length,
    callDays: Object.keys(state.calls).length,
    deals: state.deals.length,
    weeks: Object.keys(state.weeks).length,
  };
  return { ok: true, state: withDefaults(state), summary, warnings };
}

/**
 * Read the stored state row. No row gives an empty state. A row that fails validation
 * returns an error instead, so the page can refuse to edit (and overwrite) it.
 */
export function stateFromRow(data: unknown): { state: GrowthState; error: null } | { state: null; error: string } {
  if (data == null) return { state: emptyState(), error: null };
  const r = validateState(data);
  return r.ok ? { state: r.state, error: null } : { state: null, error: r.errors.join(" ") };
}

/** Check a plan before saving. Returns a list of problems, empty when the plan is fine. */
export function validatePlan(plan: unknown): string[] {
  const errs: string[] = [];
  if (!isObj(plan)) return ["The plan must be an object."];
  if (!isNum(plan.year) || plan.year < 2000 || plan.year > 2100 || !Number.isInteger(plan.year)) errs.push("Year must be a whole year.");
  if (!isNum(plan.goal) || plan.goal <= 0) errs.push("Goal must be a number of dollars above zero.");
  if (!Array.isArray(plan.h1Actuals) || plan.h1Actuals.length !== 6 || !plan.h1Actuals.every((v) => isNum(v) && v >= 0))
    errs.push("January to June actuals must be six numbers.");
  if (!Array.isArray(plan.months) || plan.months.length !== 6) errs.push("The plan needs six months, July to December.");
  else
    plan.months.forEach((m, i) => {
      const fields: (keyof PlanMonth)[] = ["rev", "calls", "signings", "active", "newMrr", "base", "projects"];
      if (!isObj(m) || !fields.every((f) => isNum(m[f]) && (m[f] as number) >= 0)) errs.push(`${MONTHS[i + 6]} has a missing or negative number.`);
    });
  if (typeof plan.assumptions !== "string") errs.push("Assumptions must be text.");
  if (typeof plan.targetsFrom !== "string" || (plan.targetsFrom !== "" && !isValidDate(plan.targetsFrom)))
    errs.push("Targets-from must be a date (YYYY-MM-DD) or empty.");
  return errs;
}

export function planFromRow(data: unknown): GrowthPlan | null {
  return validatePlan(data).length === 0 ? (data as GrowthPlan) : null;
}

/**
 * Browser console command that copies the old app's numbers to the clipboard. Run it in
 * the DevTools console on goodo-growth-dashboard.vercel.app, in the browser that holds them.
 */
export const EXPORT_CONSOLE_COMMAND = `copy(localStorage.getItem('${OLD_STORAGE_KEY}'))`;
