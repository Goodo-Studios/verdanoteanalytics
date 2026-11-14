// OS-023: the scorecard rules of public.os_scorecard, in JavaScript, for the sample script before the
// migration reaches staging. Keep the two in step (supabase/migrations/20261205080001_*.sql).

const KEYS = [
  "briefs_done", "briefs_on_time", "cuts_to_strategist", "cuts_to_strategist_on_time",
  "cuts_to_client", "cuts_to_client_on_time", "internal_revisions", "client_revisions", "completed",
];
const MILESTONE = {
  brief_due: ["briefs_done", "briefs_on_time", "brief_due_date"],
  cut_to_strategist: ["cuts_to_strategist", "cuts_to_strategist_on_time", "cut_to_strategist_date"],
  cut_to_client: ["cuts_to_client", "cuts_to_client_on_time", "cut_to_client_date"],
};
const MOVES = { "internal review edits": "internal_revisions", "client revisions": "client_revisions", complete: "completed" };

/** month: "YYYY-MM". Returns client rows sorted by slug (no client last), then one total row. */
export function scorecard({ month, tasks, history, milestones }) {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const statusMilestones = new Map();
  for (const m of milestones) statusMilestones.set(m.status, [...(statusMilestones.get(m.status) ?? []), m.milestone]);
  const inMonth = (iso) => new Date(iso).toISOString().slice(0, 7) === month;

  const firsts = new Map();
  for (const h of history) {
    for (const ms of statusMilestones.get(h.to_status) ?? []) {
      const k = `${h.task_id}|${ms}`;
      const prev = firsts.get(k);
      if (!prev || new Date(h.changed_at) < new Date(prev.at)) firsts.set(k, { task: h.task_id, ms, at: h.changed_at });
    }
  }

  const byClient = new Map();
  const row = (slug) => {
    if (!byClient.has(slug)) byClient.set(slug, Object.fromEntries(KEYS.map((k) => [k, 0])));
    return byClient.get(slug);
  };

  for (const f of firsts.values()) {
    const t = taskById.get(f.task);
    if (!t || !inMonth(f.at)) continue;
    const [count, onTime, dateCol] = MILESTONE[f.ms];
    const r = row(t.client_slug ?? null);
    r[count]++;
    const day = new Date(f.at).toISOString().slice(0, 10);
    if (t[dateCol] && day <= t[dateCol]) r[onTime]++;
  }
  for (const h of history) {
    const key = MOVES[h.to_status];
    const t = taskById.get(h.task_id);
    if (!key || !t || !inMonth(h.changed_at) || h.from_status === h.to_status) continue;
    row(t.client_slug ?? null)[key]++;
  }

  const clients = [...byClient.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([client_slug, r]) => ({ is_total: false, client_slug, ...r }));
  const total = { is_total: true, client_slug: null, ...Object.fromEntries(KEYS.map((k) => [k, 0])) };
  for (const c of clients) for (const k of KEYS) total[k] += c[k];
  return [...clients, total];
}
