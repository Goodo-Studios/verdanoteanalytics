// Actor page: staff page (consolidation step 5b, port of the old dashboard's
// Actor detail). Profile fields (direct write under the staff row rule on
// actors), the clients the actor is cast on with their shoot date, and their
// headshot, photos and videos through signed links.
//
// The casting list is read only: casting, shoot scheduling and call sheets move
// with step 5c. Not ported: uploading or reordering media.
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError } from "./api";
import { loadActorDetail, saveActor, type ActorDetail } from "./rosterApi";
import { actorFormToPatch, actorStageLabel, actorToForm, safeHref, type ActorForm } from "./rosterModel";
import { errorText, formatDay } from "./model";

const CTRL = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";
const TEXT_FIELDS: { key: keyof ActorForm; label: string; type?: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone" },
  { key: "gender", label: "Gender" },
  { key: "age_range", label: "Age range (comma separated)" },
  { key: "skills", label: "Skills (comma separated)" },
  { key: "kids_in_videos", label: "Kids in videos" },
  { key: "social_url", label: "Social link" },
  { key: "additional_social_url", label: "Second social link" },
];

function MediaList({ title, items, links }: { title: string; items: { id: string; storage_path: string; thumbnail_path?: string | null; title?: string | null; caption?: string | null }[]; links: Map<string, string> }) {
  const video = title === "Videos";
  return (
    <section aria-label={title} className="rounded-lg border p-3">
      <h2 className="text-sm font-semibold">{title} ({items.length})</h2>
      {items.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">None yet.</p> : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {items.map((m, i) => {
            const url = links.get(m.storage_path);
            const thumb = video ? (m.thumbnail_path ? links.get(m.thumbnail_path) : undefined) : url;
            const label = (video ? m.title : m.caption) || `${video ? "Video" : "Photo"} ${i + 1}`;
            return (
              <li key={m.id} className="w-32 text-xs">
                {thumb ? <img src={thumb} alt={label} className="h-24 w-32 rounded object-cover" /> : <div className="h-24 w-32 rounded bg-muted" />}
                <div className="truncate">{label}</div>
                {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="underline">{video ? "Play" : "Open"}</a> : <span className="text-muted-foreground">File not in storage</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function ActorDetailPage() {
  const { id = "" } = useParams();
  const prefix = useRolePrefix();
  const [detail, setDetail] = useState<ActorDetail | null>(null);
  const [form, setForm] = useState<ActorForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await loadActorDetail(id);
      setDetail(d);
      setForm(d.actor ? actorToForm(d.actor) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the actor.");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!detail) {
    return (
      <div className="p-6" data-testid="actor-detail-page">
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <p role="status" className="text-sm text-muted-foreground">Loading the actor...</p>}
      </div>
    );
  }
  const a = detail.actor;
  if (!a || !form) {
    return (
      <div className="p-6 space-y-2" data-testid="actor-detail-page">
        <p className="text-sm">No actor with this id.</p>
        <Link to={`${prefix}/actors`} className="text-sm underline">Back to Actors</Link>
      </div>
    );
  }

  const field = (key: keyof ActorForm, value: string | boolean) => setForm({ ...form, [key]: value });
  const save = async () => {
    setError(null);
    setNotice(null);
    const parsed = actorFormToPatch(form);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    try {
      await saveActor(a.id, parsed.patch);
      setNotice("Saved.");
      await load();
    } catch (e) {
      setError(e instanceof DashboardError ? errorText(e.code, e.message) : "The changes were not saved.");
    }
    setSaving(false);
  };

  const headshot = a.headshot_path ? detail.links.get(a.headshot_path) : undefined;
  const socials = [safeHref(a.social_url), safeHref(a.additional_social_url)].filter((x): x is string => !!x);

  return (
    <div className="p-6 space-y-4" data-testid="actor-detail-page">
      <Link to={`${prefix}/actors`} className="text-sm underline">Back to Actors</Link>
      <PageHeader
        title={a.name}
        description={[a.source === "application" ? "Added from an approved application" : a.source === "manual" ? "Added by hand" : `Source: ${a.source}`, a.import_notes].filter(Boolean).join(". ")}
      />
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-4">
        <div className="w-40">
          {headshot ? <img src={headshot} alt={`Headshot of ${a.name}`} className="h-40 w-40 rounded object-cover" />
            : <div className="flex h-40 w-40 items-center justify-center rounded bg-muted text-xs text-muted-foreground">{a.headshot_path ? "Headshot not in storage" : "No headshot"}</div>}
          {socials.map((href, i) => <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="mt-1 block text-xs underline">{i === 0 ? "Social" : "Second social"}</a>)}
        </div>
        <form aria-label="Profile" className="flex-1 space-y-3 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="grid gap-2 sm:grid-cols-2">
            {TEXT_FIELDS.map((f) => (
              <label key={f.key} className="text-xs">{f.label}
                <input type={f.type ?? "text"} className={`${CTRL} block w-full`} value={form[f.key] as string} onChange={(e) => field(f.key, e.target.value)} />
              </label>
            ))}
            <label className="text-xs">Dog owner
              <select className={`${CTRL} block w-full`} value={form.dog_owner} onChange={(e) => field("dog_owner", e.target.value)}>
                <option value="">Not asked</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          </div>
          <label className="block text-xs">Notes
            <textarea className={`${CTRL} block w-full`} rows={3} value={form.notes} onChange={(e) => field("notes", e.target.value)} />
          </label>
          <label className="text-sm"><input type="checkbox" checked={form.do_not_use_again} onChange={(e) => field("do_not_use_again", e.target.checked)} /> Do not use again</label>
          <div><button type="submit" className={CTRL} disabled={saving}>{saving ? "Saving..." : "Save profile"}</button></div>
        </form>
      </div>

      <section aria-label="Castings" className="rounded-lg border p-3">
        <h2 className="text-sm font-semibold">Castings ({detail.castings.length})</h2>
        {detail.castings.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">Not cast on any client yet.</p> : (
          <ul className="mt-1 text-sm">
            {detail.castings.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-2 border-t py-1.5">
                <Link to={`${prefix}/clients/${encodeURIComponent(c.client_slug)}`} className="font-medium underline">{c.clients?.name ?? c.client_slug}</Link>
                <span>{actorStageLabel(c.stage)}</span>
                {c.scheduled_shoot_date && <span className="text-muted-foreground">Shoot {formatDay(c.scheduled_shoot_date)}{c.shoot_location ? `, ${c.shoot_location}` : ""}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Casting and shoot scheduling stay on the old dashboard until the production pages move into Verdanote.</p>
      </section>

      <MediaList title="Videos" items={detail.videos} links={detail.links} />
      <MediaList title="Photos" items={detail.photos} links={detail.links} />
    </div>
  );
}
