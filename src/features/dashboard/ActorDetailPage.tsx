// Actor page: staff page (consolidation step 5b, port of the old dashboard's
// Actor detail). Profile fields (direct write under the staff row rule on
// actors), the clients the actor is cast on with their shoot date, and their
// headshot, photos and videos through signed links. Staff add and delete the
// headshot, photos and videos here (phase 6b, ./media).
//
// The casting list is read only here; casting is managed on the Casting page
// and shoots on the Production calendar (step 5c). Not ported: reordering media.
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState, PageHeader, PageShell, SelectField, TextField, TextareaField } from "@/components/page-kit";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError } from "./api";
import { loadActorDetail, saveActor, type ActorDetail } from "./rosterApi";
import { HeadshotControl, MediaSection } from "./media/MediaSection";
import { MEDIA_KINDS } from "./media/mediaModel";
import { actorFormToPatch, actorStageLabel, actorToForm, safeHref, type ActorForm } from "./rosterModel";
import { errorText, formatDay } from "./model";
import { EmbeddedShell } from "./RecordModal";

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

/** `embedded` is the modal on the Actors page: the id comes in as a prop and the back link is hidden. */
export default function ActorDetailPage({ actorId, embedded = false }: { actorId?: string; embedded?: boolean } = {}) {
  const params = useParams();
  const id = actorId ?? params.id ?? "";
  const Shell = embedded ? EmbeddedShell : PageShell;
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
      <Shell data-testid="actor-detail-page">
        {error ? <ErrorState message={error} onRetry={() => { setError(null); void load(); }} /> : <LoadingState label="Loading the actor" />}
      </Shell>
    );
  }
  const a = detail.actor;
  if (!a || !form) {
    return (
      <Shell data-testid="actor-detail-page">
        <p className="text-sm">No actor with this id.</p>
        {!embedded && <Link to={`${prefix}/actors`} className="text-sm underline">Back to Actors</Link>}
      </Shell>
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
    <Shell data-testid="actor-detail-page">
      {!embedded && <Link to={`${prefix}/actors`} className="text-sm underline">Back to Actors</Link>}
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
          <HeadshotControl cfg={MEDIA_KINDS["actor-headshot"]} ownerId={a.id} path={a.headshot_path} onChanged={load} onNotice={setNotice} />
          {socials.map((href, i) => <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="mt-1 block text-xs underline">{i === 0 ? "Social" : "Second social"}</a>)}
        </div>
        <form aria-label="Profile" className="flex-1 space-y-3 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="grid gap-2 sm:grid-cols-2">
            {TEXT_FIELDS.map((f) => (
              <TextField key={f.key} label={f.label} type={f.type ?? "text"} value={form[f.key] as string} onChange={(e) => field(f.key, e.target.value)} />
            ))}
            <SelectField label="Dog owner" value={form.dog_owner} onChange={(e) => field("dog_owner", e.target.value)} placeholder="Not asked" options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
          </div>
          <TextareaField label="Notes" rows={3} value={form.notes} onChange={(e) => field("notes", e.target.value)} />
          <label className="text-sm"><input type="checkbox" checked={form.do_not_use_again} onChange={(e) => field("do_not_use_again", e.target.checked)} /> Do not use again</label>
          <div><Button type="submit" variant="outline" disabled={saving}>{saving ? "Saving..." : "Save profile"}</Button></div>
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
                <Link to={`${prefix}/casting?brand=${encodeURIComponent(c.client_slug)}`} className="underline">Casting</Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Change stages and casting links on the <Link to={`${prefix}/casting`} className="underline">Casting</Link> page and book shoots on the <Link to={`${prefix}/production-calendar`} className="underline">Production calendar</Link>.</p>
      </section>

      <MediaSection
        cfg={MEDIA_KINDS["actor-video"]}
        ownerId={a.id}
        title="Videos"
        items={detail.videos.map((v, i) => ({ id: v.id, storage_path: v.storage_path, thumbnail_path: v.thumbnail_path, label: v.title || `Video ${i + 1}`, sort_order: v.sort_order }))}
        links={detail.links}
        onChanged={load}
        onNotice={setNotice}
      />
      <MediaSection
        cfg={MEDIA_KINDS["actor-photo"]}
        ownerId={a.id}
        title="Photos"
        items={detail.photos.map((p, i) => ({ id: p.id, storage_path: p.storage_path, label: p.caption || `Photo ${i + 1}` }))}
        links={detail.links}
        onChanged={load}
        onNotice={setNotice}
      />
    </Shell>
  );
}
