// Creator page: staff page (consolidation step 5b, port of the old dashboard's
// Creator detail). Profile fields (direct write under the staff row rule on
// dashboard_creators), the brands the creator is on with links to the client
// page and the Creator pipeline, adding the creator to another brand, and
// their headshot, videos, family and pet photos and filming locations through
// signed links.
//
// Not ported: uploading or reordering media (the old dashboard keeps doing
// that until the release), the shipment log and the calendar.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState, PageHeader, PageShell, SelectField, TextField, TextareaField } from "@/components/page-kit";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError, addCreatorsToBrand, loadBrandsAndTeam, type BrandOption } from "./api";
import { loadCreatorDetail, saveCreator, type CreatorDetail, type CreatorPhoto } from "./rosterApi";
import {
  CREATOR_CATEGORIES,
  creatorFormToPatch,
  creatorToForm,
  safeHref,
  splitCategories,
  type CreatorForm,
} from "./rosterModel";
import { errorText, formatDay, stageLabel } from "./model";

const FLAGS: { key: keyof CreatorForm; label: string }[] = [
  { key: "trialed", label: "Trialed" },
  { key: "do_not_use_again", label: "Do not use again" },
  { key: "alcohol_ok", label: "Alcohol OK" },
  { key: "cbd_ok", label: "CBD OK" },
  { key: "thc_ok", label: "THC OK" },
  { key: "family_inclusive_ok", label: "Family inclusive OK" },
];
const TEXT_FIELDS: { key: keyof CreatorForm; label: string; type?: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email", type: "email" },
  { key: "website", label: "Website" },
  { key: "portfolio_url", label: "Portfolio" },
  { key: "gender", label: "Gender" },
  { key: "scale", label: "Scale (1 to 5)" },
  { key: "age_range", label: "Age range (comma separated)" },
  { key: "location", label: "Location" },
];

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof DashboardError) return e.code === "23505" ? "This creator is already on that client." : errorText(e.code, e.message || fallback);
  return e instanceof Error ? e.message : fallback;
}

function Gallery({ title, items, links, caption }: { title: string; items: CreatorPhoto[]; links: Map<string, string>; caption: (p: CreatorPhoto) => string }) {
  return (
    <section aria-label={title} className="rounded-lg border p-3">
      <h2 className="text-sm font-semibold">{title} ({items.length})</h2>
      {items.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">None yet.</p> : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {items.map((p) => {
            const url = links.get(p.storage_path);
            return (
              <li key={p.id} className="w-32 text-xs">
                {url ? <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={caption(p)} className="h-24 w-32 rounded object-cover" /></a>
                  : <div className="flex h-24 w-32 items-center justify-center rounded bg-muted text-muted-foreground">File not in storage</div>}
                <div className="truncate">{caption(p)}</div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function CreatorDetailPage() {
  const { id = "" } = useParams();
  const prefix = useRolePrefix();
  const [detail, setDetail] = useState<CreatorDetail | null>(null);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [form, setForm] = useState<CreatorForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addBrand, setAddBrand] = useState("");

  const load = useCallback(async () => {
    try {
      const [d, base] = await Promise.all([loadCreatorDetail(id), loadBrandsAndTeam()]);
      setDetail(d);
      setBrands(base.brands);
      setForm(d.creator ? creatorToForm(d.creator) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the creator.");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const onBrands = useMemo(() => new Set((detail?.brands ?? []).map((b) => b.client_slug)), [detail]);
  const addable = brands.filter((b) => b.active && b.does_creators && !onBrands.has(b.slug));
  const legacy = form ? splitCategories(form.categories).legacy : [];

  if (!detail) {
    return (
      <PageShell data-testid="creator-detail-page">
        {error ? <ErrorState message={error} onRetry={() => { setError(null); void load(); }} /> : <LoadingState label="Loading the creator" />}
      </PageShell>
    );
  }
  const c = detail.creator;
  if (!c || !form) {
    return (
      <PageShell data-testid="creator-detail-page">
        <p className="text-sm">No creator with this id.</p>
        <Link to={`${prefix}/creators`} className="text-sm underline">Back to Creators</Link>
      </PageShell>
    );
  }

  const field = (key: keyof CreatorForm, value: string | boolean | string[]) => setForm({ ...form, [key]: value });
  const toggleCategory = (cat: string, on: boolean) =>
    field("categories", on ? [...form.categories, cat] : form.categories.filter((x) => x !== cat));

  const save = async () => {
    setError(null);
    setNotice(null);
    const parsed = creatorFormToPatch(form);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    try {
      await saveCreator(c.id, parsed.patch);
      setNotice("Saved.");
      await load();
    } catch (e) {
      setError(messageOf(e, "The changes were not saved."));
    }
    setSaving(false);
  };

  const add = async () => {
    if (!addBrand) return;
    setError(null);
    setNotice(null);
    try {
      await addCreatorsToBrand(addBrand, [c.id]);
      setNotice(`Added to ${brands.find((b) => b.slug === addBrand)?.name ?? addBrand}.`);
      setAddBrand("");
      await load();
    } catch (e) {
      setError(messageOf(e, "The creator was not added to the client."));
    }
  };

  const headshot = c.headshot_path ? detail.links.get(c.headshot_path) : undefined;
  const portfolio = safeHref(c.portfolio_url) ?? safeHref(c.website);

  return (
    <PageShell data-testid="creator-detail-page">
      <Link to={`${prefix}/creators`} className="text-sm underline">Back to Creators</Link>
      <PageHeader
        title={c.name}
        description={[c.source === "application" ? "Added from an approved application" : c.source === "manual" ? "Added by hand" : `Source: ${c.source}`, c.import_notes].filter(Boolean).join(". ")}
      />
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-4">
        <div className="w-40">
          {headshot ? <img src={headshot} alt={`Headshot of ${c.name}`} className="h-40 w-40 rounded object-cover" />
            : <div className="flex h-40 w-40 items-center justify-center rounded bg-muted text-xs text-muted-foreground">{c.headshot_path ? "Headshot not in storage" : "No headshot"}</div>}
          {portfolio && <a href={portfolio} target="_blank" rel="noopener noreferrer" className="mt-1 block text-xs underline">Portfolio</a>}
        </div>

        <form aria-label="Profile" className="flex-1 space-y-3 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="grid gap-2 sm:grid-cols-2">
            {TEXT_FIELDS.map((f) => (
              <TextField key={f.key} label={f.label} type={f.type ?? "text"} value={form[f.key] as string} onChange={(e) => field(f.key, e.target.value)} />
            ))}
          </div>
          <TextareaField label="Shipping address" rows={2} value={form.shipping_address} onChange={(e) => field("shipping_address", e.target.value)} />
          <TextareaField label="Contact notes" rows={3} value={form.contact_notes} onChange={(e) => field("contact_notes", e.target.value)} />
          <fieldset>
            <legend className="text-xs font-medium">Categories</legend>
            <div className="flex flex-wrap gap-x-3">
              {CREATOR_CATEGORIES.map((cat) => (
                <label key={cat} className="text-sm"><input type="checkbox" checked={form.categories.includes(cat)} onChange={(e) => toggleCategory(cat, e.target.checked)} /> {cat}</label>
              ))}
            </div>
            {legacy.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Imported categories kept as they are: {legacy.join(", ")}</p>}
          </fieldset>
          <div className="flex flex-wrap gap-x-3">
            {FLAGS.map((f) => (
              <label key={f.key} className="text-sm"><input type="checkbox" checked={form[f.key] as boolean} onChange={(e) => field(f.key, e.target.checked)} /> {f.label}</label>
            ))}
          </div>
          <Button type="submit" variant="outline" disabled={saving}>{saving ? "Saving..." : "Save profile"}</Button>
        </form>
      </div>

      <section aria-label="Clients" className="rounded-lg border p-3">
        <h2 className="text-sm font-semibold">Clients ({detail.brands.length})</h2>
        {detail.brands.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">Not on any brand yet.</p> : (
          <ul className="mt-1 text-sm">
            {detail.brands.map((b) => (
              <li key={b.id} className="flex flex-wrap gap-2 border-t py-1.5">
                <Link to={`${prefix}/clients/${encodeURIComponent(b.client_slug)}`} className="font-medium underline">{b.clients?.name ?? b.client_slug}</Link>
                <span>{stageLabel(b.stage)}</span>
                {b.next_follow_up_at && <span className="text-muted-foreground">Follow up {formatDay(b.next_follow_up_at)}</span>}
                <Link to={`${prefix}/creator-pipeline?brand=${encodeURIComponent(b.client_slug)}`} className="underline">Open in Creator pipeline</Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SelectField label="Add to client" hideLabel className="w-56" value={addBrand} onChange={(e) => setAddBrand(e.target.value)} placeholder="Choose a client" options={addable.map((b) => ({ value: b.slug, label: b.name }))} />
          <Button type="button" variant="outline" disabled={!addBrand} onClick={() => void add()}>Add to client</Button>
        </div>
      </section>

      <section aria-label="Videos" className="rounded-lg border p-3">
        <h2 className="text-sm font-semibold">Videos ({detail.videos.length})</h2>
        {detail.videos.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">None yet.</p> : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {detail.videos.map((v, i) => {
              const url = detail.links.get(v.storage_path);
              const thumb = v.thumbnail_path ? detail.links.get(v.thumbnail_path) : undefined;
              const label = v.title || `Video ${i + 1}`;
              return (
                <li key={v.id} className="w-32 text-xs">
                  {thumb ? <img src={thumb} alt={label} className="h-24 w-32 rounded object-cover" /> : <div className="h-24 w-32 rounded bg-muted" />}
                  <div className="truncate">{label}{v.format ? ` (${v.format.replace("_", " ")})` : ""}</div>
                  {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="underline">Play</a> : <span className="text-muted-foreground">File not in storage</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <Gallery title="Family and pet photos" items={detail.photos} links={detail.links} caption={(p) => p.caption || (p.category === "pet" ? "Pet" : "Family")} />
      <Gallery title="Filming locations" items={detail.locations} links={detail.links} caption={(p) => p.label || "Filming location"} />
    </PageShell>
  );
}
