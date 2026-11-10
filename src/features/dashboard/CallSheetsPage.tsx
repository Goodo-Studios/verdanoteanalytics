// Call sheets: staff page (consolidation step 5c). One call sheet per shoot,
// merged from the old dashboard's call sheet and Goodo OS's call sheet:
// call time, wrap estimate, general notes and crew from the old dashboard,
// and a line per confirmed talent (call time, wardrobe, notes for the talent,
// and staff-only rate and internal notes) from Goodo OS. Staff make a sheet
// for a shoot, edit it, revoke and restore its link, and keep the talent lines.
// The public call sheet page stays on the old dashboard and reads the old
// database until the release; the page says so next to every link.
// Not ported: Goodo OS's immutable published versions and the talent portal.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError, loadBrandsAndTeam } from "./api";
import { createCallSheet, loadCallSheets, removeTalentLine, saveTalentLine, setCallSheetRevoked, updateCallSheet, type CallSheetsData } from "./callSheetsApi";
import {
  EMPTY_SHEET_FORM,
  callSheetUrl,
  currentSheet,
  entryToForm,
  formToSheetArgs,
  formToTalentArgs,
  sheetToForm,
  splitShoots,
  talentLines,
  type CallSheet,
  type CrewOption,
  type SheetForm,
  type SheetShoot,
  type TalentForm,
  type TalentLine,
} from "./callSheetsModel";
import { formatTime } from "./productionModel";
import { errorText, formatDay } from "./model";

const CTRL = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";
/** Past shoots shown: the last 60 days. */
const PAST_DAYS = 60;

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof DashboardError) return e.code === "42501" ? errorText(e.code, fallback) : e.message || fallback;
  return e instanceof Error ? e.message : fallback;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function SheetEditor({ initial, title, busy, crew, onSave, onCancel }: {
  initial: SheetForm; title: string; busy: boolean; crew: CrewOption[]; onSave: (f: SheetForm) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const set = (patch: Partial<SheetForm>) => setForm((f) => ({ ...f, ...patch }));
  const offered = crew.filter((c) => c.active || form.crew.includes(c.id));
  return (
    <form aria-label={title} className="space-y-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs">Call time<input aria-label="Call time" type="time" className={`${CTRL} mt-0.5 w-full`} value={form.call_time} onChange={(e) => set({ call_time: e.target.value })} /></label>
        <label className="text-xs">Wrap estimate<input aria-label="Wrap estimate" className={`${CTRL} mt-0.5 w-full`} placeholder="About 5 PM" value={form.wrap_time_estimate} onChange={(e) => set({ wrap_time_estimate: e.target.value })} /></label>
        <label className="text-xs sm:col-span-3">General notes<textarea aria-label="General notes" rows={3} className={`${CTRL} mt-0.5 w-full`} value={form.general_notes} onChange={(e) => set({ general_notes: e.target.value })} /></label>
      </div>
      <fieldset className="text-xs">
        <legend className="font-medium">Crew on this call sheet</legend>
        {offered.length === 0 ? <p className="text-muted-foreground">No active crew. Add people on the Crew page.</p> : (
          <div className="flex flex-wrap gap-3">
            {offered.map((c) => (
              <label key={c.id}>
                <input type="checkbox" checked={form.crew.includes(c.id)} onChange={(e) => set({ crew: e.target.checked ? [...form.crew, c.id] : form.crew.filter((x) => x !== c.id) })} /> {c.name} ({c.role}){!c.active && " (archived)"}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="flex gap-2">
        <button type="submit" className={CTRL} disabled={busy}>{busy ? "Saving..." : "Save call sheet"}</button>
        <button type="button" className={CTRL} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function TalentEditor({ line, busy, onSave, onCancel }: { line: TalentLine; busy: boolean; onSave: (f: TalentForm) => void; onCancel: () => void }) {
  const [form, setForm] = useState(() => entryToForm(line.entry));
  const set = (patch: Partial<TalentForm>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <form aria-label={`Talent line for ${line.name}`} className="space-y-2 rounded border p-2" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">Talent call time<input aria-label="Talent call time" type="time" className={`${CTRL} mt-0.5 w-full`} value={form.call_time} onChange={(e) => set({ call_time: e.target.value })} /></label>
        <label className="text-xs">Wardrobe<input aria-label="Wardrobe" className={`${CTRL} mt-0.5 w-full`} value={form.wardrobe} onChange={(e) => set({ wardrobe: e.target.value })} /></label>
        <label className="text-xs sm:col-span-2">Notes for the talent<input aria-label="Notes for the talent" className={`${CTRL} mt-0.5 w-full`} value={form.talent_notes} onChange={(e) => set({ talent_notes: e.target.value })} /></label>
        <label className="text-xs">Rate note (staff only)<input aria-label="Rate note" className={`${CTRL} mt-0.5 w-full`} value={form.rate_note} onChange={(e) => set({ rate_note: e.target.value })} /></label>
        <label className="text-xs">Internal note (staff only)<input aria-label="Internal note" className={`${CTRL} mt-0.5 w-full`} value={form.internal_note} onChange={(e) => set({ internal_note: e.target.value })} /></label>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={CTRL} disabled={busy}>{busy ? "Saving..." : "Save line"}</button>
        <button type="button" className={CTRL} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function CallSheetsPage() {
  const prefix = useRolePrefix();
  const [data, setData] = useState<CallSheetsData | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [showPast, setShowPast] = useState(false);
  const [editingSheet, setEditingSheet] = useState<string | null>(null);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const today = useMemo(() => isoDay(new Date()), []);
  const from = useMemo(() => isoDay(new Date(Date.now() - PAST_DAYS * 86_400_000)), []);

  const load = useCallback(async () => {
    try {
      setData(await loadCallSheets(from));
    } catch (e) {
      setError(messageOf(e, "Could not load call sheets."));
    }
  }, [from]);
  useEffect(() => {
    void load();
    loadBrandsAndTeam().then((b) => setNames(new Map(b.brands.map((x) => [x.slug, x.name]))), () => setNames(new Map()));
  }, [load]);

  const { upcoming, past } = useMemo(() => splitShoots(data?.shoots ?? [], today), [data, today]);
  const crewNames = useMemo(() => new Map((data?.crew ?? []).map((c) => [c.id, `${c.name} (${c.role})`])), [data]);

  const run = async (fn: () => Promise<string>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    let ok = true;
    try {
      setNotice(await fn());
    } catch (e) {
      setError(messageOf(e, "The change could not be saved."));
      ok = false;
    }
    setBusy(false);
    await load();
    return ok;
  };

  const clientName = (s: SheetShoot) => names.get(s.client_slug) ?? s.client_slug;
  const where = (s: SheetShoot) => (s.location_id ? data?.locations.get(s.location_id) ?? "Linked location" : s.location) ?? "No location yet";

  const saveSheet = (s: SheetShoot, sheet: CallSheet | null, form: SheetForm) => {
    let args;
    try {
      args = formToSheetArgs(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the form.");
      return;
    }
    void run(async () => {
      if (sheet) {
        await updateCallSheet(sheet.id, args);
        return `Call sheet saved for ${clientName(s)} on ${formatDay(s.shoot_date)}.`;
      }
      await createCallSheet(s.id, args);
      return `Call sheet made for ${clientName(s)} on ${formatDay(s.shoot_date)}.`;
    }).then((ok) => { if (ok) setEditingSheet(null); });
  };

  const toggleRevoked = (sheet: CallSheet) => {
    if (!sheet.revoked && !window.confirm("Revoke this call sheet link? Anyone holding it can no longer open it once the public page reads this database.")) return;
    void run(async () => {
      await setCallSheetRevoked(sheet.id, !sheet.revoked);
      return sheet.revoked ? "Link restored." : "Link revoked.";
    });
  };

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).then(() => setNotice("Link copied."), () => setNotice(`Copy the link: ${url}`));
  };

  const saveLine = (sheet: CallSheet, line: TalentLine, form: TalentForm) => {
    let args;
    try {
      args = formToTalentArgs(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the form.");
      return;
    }
    void run(async () => {
      await saveTalentLine(sheet.id, line.assignmentId, args);
      return `Saved the line for ${line.name}.`;
    }).then((ok) => { if (ok) setEditingLine(null); });
  };

  const removeLine = (sheet: CallSheet, line: TalentLine) => {
    if (!window.confirm(`Remove the call sheet line for ${line.name}?`)) return;
    void run(async () => {
      await removeTalentLine(sheet.id, line.assignmentId);
      return `Removed the line for ${line.name}.`;
    });
  };

  const renderShoot = (s: SheetShoot) => {
    const sheet = currentSheet(s);
    const lines = sheet ? talentLines(sheet, s.id, data?.castings ?? []) : [];
    const confirmedCount = (data?.castings ?? []).filter((c) => c.shoot_id === s.id).length;
    const url = sheet ? callSheetUrl(sheet.token) : null;
    return (
      <article key={s.id} className="space-y-2 rounded-lg border p-3" data-testid={`call-sheet-shoot-${s.id}`}>
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-semibold">{formatDay(s.shoot_date)}</h3>
          <Link to={`${prefix}/clients/${encodeURIComponent(s.client_slug)}`} className="text-sm underline">{clientName(s)}</Link>
          <span className="text-xs text-muted-foreground">{where(s)}</span>
          {sheet && <span className="rounded bg-muted px-1 text-xs">{sheet.revoked ? "Link revoked" : "Link live"}</span>}
        </div>

        {editingSheet === s.id ? (
          <SheetEditor
            initial={sheet ? sheetToForm(sheet) : EMPTY_SHEET_FORM}
            title={sheet ? "Edit call sheet" : "Make a call sheet"}
            busy={busy}
            crew={data?.crew ?? []}
            onSave={(f) => saveSheet(s, sheet, f)}
            onCancel={() => setEditingSheet(null)}
          />
        ) : !sheet ? (
          <div className="text-sm">
            <p className="text-muted-foreground">No call sheet yet.</p>
            <button type="button" className={CTRL} onClick={() => { setEditingSheet(s.id); setError(null); setNotice(null); }}>Make a call sheet</button>
          </div>
        ) : (
          <div className="space-y-1 text-sm">
            <p>
              Call {sheet.call_time ? formatTime(sheet.call_time) : "time not set"}
              {sheet.wrap_time_estimate && <> · Wrap {sheet.wrap_time_estimate}</>}
            </p>
            {sheet.general_notes && <p className="whitespace-pre-line text-xs">{sheet.general_notes}</p>}
            <p className="text-xs">
              Crew: {sheet.call_sheet_crew.length === 0 ? "none yet" : sheet.call_sheet_crew.map((c) => crewNames.get(c.crew_member_id) ?? "Removed crew member").join(", ")}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" className="underline" onClick={() => { setEditingSheet(s.id); setError(null); setNotice(null); }}>Edit</button>
              <button type="button" className="underline" disabled={busy} onClick={() => toggleRevoked(sheet)}>{sheet.revoked ? "Restore link" : "Revoke link"}</button>
              {url && !sheet.revoked && (
                <>
                  <a href={url} target="_blank" rel="noreferrer" className="underline">Open public call sheet</a>
                  <button type="button" className="underline" onClick={() => copy(url)}>Copy link</button>
                </>
              )}
            </div>
          </div>
        )}

        {sheet && (
          <section aria-label="Talent lines" className="space-y-1">
            <h4 className="text-xs font-semibold">Talent</h4>
            {lines.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {confirmedCount === 0 ? "No talent confirmed onto this shoot. Confirm talent on the Production calendar." : "No talent lines."}
              </p>
            ) : (
              <ul className="space-y-1">
                {lines.map((line) => {
                  const key = `${sheet.id}:${line.assignmentId}`;
                  const e = line.entry;
                  return (
                    <li key={line.assignmentId} className="text-xs" data-testid={`talent-line-${line.assignmentId}`}>
                      {editingLine === key ? (
                        <TalentEditor line={line} busy={busy} onSave={(f) => saveLine(sheet, line, f)} onCancel={() => setEditingLine(null)} />
                      ) : (
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-medium">{line.name}</span>
                          {line.stale && <span className="rounded bg-destructive/10 px-1 text-destructive">No longer on this shoot</span>}
                          {e ? (
                            <span className="text-muted-foreground">
                              {e.call_time ? `Call ${formatTime(e.call_time)}` : "Call time from the sheet"}
                              {e.wardrobe && ` · Wardrobe: ${e.wardrobe}`}
                              {e.talent_notes && ` · ${e.talent_notes}`}
                              {e.rate_note && ` · Rate (staff only): ${e.rate_note}`}
                              {e.internal_note && ` · Internal: ${e.internal_note}`}
                            </span>
                          ) : <span className="text-muted-foreground">No line saved yet</span>}
                          {!line.stale && <button type="button" className="underline" onClick={() => { setEditingLine(key); setError(null); setNotice(null); }}>{e ? "Edit line" : "Add line"}</button>}
                          {e && <button type="button" className="underline" disabled={busy} onClick={() => removeLine(sheet, line)}>Remove line</button>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </article>
    );
  };

  return (
    <div className="p-6 space-y-4" data-testid="call-sheets-page">
      <PageHeader title="Call sheets" description="One call sheet per shoot: call time, wrap, notes, crew, and a line for each confirmed talent." />
      <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" data-testid="call-sheets-old-dashboard-note">
        Crew and clients open call sheet links on the old dashboard, which reads its own database until the release. A call sheet made, changed or revoked here is this database's copy; people holding the link see the change after the release points the public page here. Talent lines, rate notes and internal notes are staff only and are never on the public page.
      </p>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link to={`${prefix}/production-calendar`} className="underline">Production calendar</Link>
        <Link to={`${prefix}/crew`} className="underline">Crew</Link>
        <Link to={`${prefix}/locations`} className="underline">Locations</Link>
      </div>
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {!data ? (
        error ? null : <p role="status" className="text-sm text-muted-foreground">Loading call sheets...</p>
      ) : (
        <>
          <section aria-label="Upcoming shoots" className="space-y-2">
            <h2 className="text-sm font-semibold">Upcoming shoots</h2>
            {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">No upcoming shoots. Schedule one on the Production calendar.</p> : upcoming.map(renderShoot)}
          </section>
          <label className="text-sm"><input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Show shoots from the last {PAST_DAYS} days</label>
          {showPast && (
            <section aria-label="Past shoots" className="space-y-2">
              <h2 className="text-sm font-semibold">Past shoots</h2>
              {past.length === 0 ? <p className="text-sm text-muted-foreground">No shoots in the last {PAST_DAYS} days.</p> : past.map(renderShoot)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
