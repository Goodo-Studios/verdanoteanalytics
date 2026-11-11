// The creator and actor application forms, opened by anyone. No login, no staff menu. Files go
// straight to storage on addresses the server makes inside this one application's folder. The
// form starts a draft on load, keeps a hidden field out of sight to catch bots, and never says
// whether an email has applied before. Nothing is emailed.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FAILURE_COPY } from "./publicLinkApi";
import { HONEYPOT_FIELD, LIMITS, callApply, checkFile, uploadFile, type ApplyKind, type UploadedFile } from "./applyApi";
import { PublicShell } from "./PublicShell";

const AGES = ["18-24", "25-34", "35-44", "45-54", "55+"];
const GENDERS = ["Woman", "Man", "Non-binary", "Prefer not to say"];
const INPUT = "mt-1 block h-11 w-full rounded-md border bg-background px-3";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="mt-4 block text-sm font-medium">
      {label}
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

export default function PublicApplyPage({ kind }: { kind: ApplyKind }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [v, setV] = useState<Record<string, string>>({});
  const [ages, setAges] = useState<string[]>([]);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [dog, setDog] = useState<"" | "yes" | "no">("");
  const [headshot, setHeadshot] = useState<UploadedFile | null>(null);
  const [videos, setVideos] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const trap = useRef<HTMLInputElement>(null);
  const limits = LIMITS.videos[kind];

  const begin = async () => {
    setStartError(null);
    const r = await callApply<{ draft_id: string }>({ kind, action: "begin" });
    if (r.ok) setDraft(r.data.draft_id);
    else setStartError(FAILURE_COPY[r.reason === "too_many_files" || r.reason === "bad_type" ? "error" : r.reason].body);
  };
  useEffect(() => {
    void begin();
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }));

  const pick = async (fileKind: "headshot" | "video", files: FileList | null) => {
    if (!files || !draft) return;
    setMessage(null);
    setBusy(true);
    for (const file of Array.from(files)) {
      if (fileKind === "video" && videos.length >= limits.max) {
        setMessage(`You can add up to ${limits.max} videos.`);
        break;
      }
      const problem = checkFile(file, fileKind);
      if (problem) {
        setMessage(problem);
        continue;
      }
      const r = await uploadFile(kind, draft, fileKind, file);
      if (!r.ok) {
        setMessage(r.reason === "too_many_files" ? "That is the most files we can take." : r.reason === "expired" ? "This page has been open a long time. Please reload it and start again." : "That file did not upload. Please try again.");
        continue;
      }
      if (fileKind === "headshot") setHeadshot(r.data);
      else setVideos((p) => [...p, r.data]);
    }
    setBusy(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setMessage(null);
    if (!v.name?.trim()) return setMessage("Please add your name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((v.email ?? "").trim())) return setMessage("Please add a valid email address.");
    if (kind === "actor" && !v.gender) return setMessage("Please choose an option for gender.");
    if (kind === "actor" && ages.length === 0) return setMessage("Please choose at least one age range.");
    if (videos.length < limits.min) return setMessage(`Please add at least ${limits.min} video${limits.min === 1 ? "" : "s"}.`);
    const payload: Record<string, unknown> = {
      name: v.name, email: v.email, gender: v.gender || null, age_range: ages, headshot_path: headshot?.path ?? null,
      videos: videos.map((f) => ({ storage_path: f.path, title: f.name.slice(0, 200), size_bytes: f.size, mime_type: f.mime })),
    };
    if (kind === "creator") {
      Object.assign(payload, {
        socials: { instagram: v.instagram || null, tiktok: v.tiktok || null }, website: v.website || null,
        categories: (v.categories ?? "").split(",").map((c) => c.trim()).filter(Boolean), location: v.location || null, shipping_address: v.shipping || null,
        alcohol_ok: !!flags.alcohol_ok, cbd_ok: !!flags.cbd_ok, thc_ok: !!flags.thc_ok, family_inclusive_ok: !!flags.family_inclusive_ok,
      });
    } else {
      Object.assign(payload, {
        phone: v.phone || null, notes: v.notes || null, dog_owner: dog === "" ? null : dog === "yes", kids_in_videos: v.kids || null,
        social_url: v.social_url || null, additional_social_url: v.additional_social_url || null,
      });
    }
    setBusy(true);
    const r = await callApply<{ ok: true }>({ kind, action: "submit", draft_id: draft, payload, [HONEYPOT_FIELD]: trap.current?.value ?? "" });
    setBusy(false);
    if (r.ok) return setDone(true);
    if (r.reason === "invalid") return setMessage(r.field === "files" ? "One of your files is missing. Please add it again." : "Please check your answers and try again.");
    if (r.reason === "expired") return setMessage("This page has been open a long time. Please reload it and start again.");
    const copy = FAILURE_COPY[r.reason === "too_many_files" || r.reason === "bad_type" ? "error" : r.reason];
    setMessage(`${copy.title}. ${copy.body}`);
  };

  const title = kind === "creator" ? "Apply to create with Goodo Studios" : "Apply to be on camera with Goodo Studios";
  if (done) {
    return (
      <PublicShell title="Thank you">
        <p role="status" className="text-muted-foreground">We got your application. If it is a fit for a project, someone from our team will be in touch.</p>
      </PublicShell>
    );
  }
  if (startError) {
    return (
      <PublicShell title="We could not open the form">
        <p role="alert" className="text-muted-foreground">{startError}</p>
        <Button type="button" className="mt-4" onClick={() => void begin()}>Try again</Button>
      </PublicShell>
    );
  }
  return (
    <PublicShell title={title}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <p className="text-muted-foreground">Tell us a little about you and add a few files. It takes about five minutes.</p>
        {/* Hidden from people. A bot that fills every field fills this one and is dropped. */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
          <label>Leave this empty<input ref={trap} name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" /></label>
        </div>
        <Field label="Your name"><input className={INPUT} value={v.name ?? ""} onChange={set("name")} maxLength={200} autoComplete="name" /></Field>
        <Field label="Email"><input className={INPUT} type="email" value={v.email ?? ""} onChange={set("email")} maxLength={254} autoComplete="email" /></Field>
        {kind === "actor" && <Field label="Phone (optional)"><input className={INPUT} type="tel" value={v.phone ?? ""} onChange={set("phone")} maxLength={40} autoComplete="tel" /></Field>}
        <Field label="Gender">
          <select className={INPUT} value={v.gender ?? ""} onChange={set("gender")}>
            <option value="">Choose one</option>
            {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Age range</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {AGES.map((a) => (
              <label key={a} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ages.includes(a)} onChange={(e) => setAges((p) => (e.target.checked ? [...p, a] : p.filter((x) => x !== a)))} /> {a}</label>
            ))}
          </div>
        </fieldset>
        {kind === "creator" ? (
          <>
            <Field label="Instagram handle (optional)"><input className={INPUT} value={v.instagram ?? ""} onChange={set("instagram")} maxLength={100} /></Field>
            <Field label="TikTok handle (optional)"><input className={INPUT} value={v.tiktok ?? ""} onChange={set("tiktok")} maxLength={100} /></Field>
            <Field label="Website (optional)"><input className={INPUT} value={v.website ?? ""} onChange={set("website")} maxLength={300} /></Field>
            <Field label="What do you like to make?" hint="Separate with commas, for example food, beauty, home."><input className={INPUT} value={v.categories ?? ""} onChange={set("categories")} maxLength={300} /></Field>
            <Field label="Where are you based?"><input className={INPUT} value={v.location ?? ""} onChange={set("location")} maxLength={200} /></Field>
            <Field label="Shipping address" hint="Only used to send product if you are picked."><textarea className="mt-1 block w-full rounded-md border bg-background p-3" rows={3} value={v.shipping ?? ""} onChange={set("shipping")} maxLength={500} /></Field>
            <fieldset className="mt-4">
              <legend className="text-sm font-medium">I am comfortable with</legend>
              {([["alcohol_ok", "Alcohol brands"], ["cbd_ok", "CBD brands"], ["thc_ok", "THC brands"], ["family_inclusive_ok", "Family members in my videos"]] as const).map(([k, l]) => (
                <label key={k} className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!flags[k]} onChange={(e) => setFlags((p) => ({ ...p, [k]: e.target.checked }))} /> {l}</label>
              ))}
            </fieldset>
          </>
        ) : (
          <>
            <fieldset className="mt-4">
              <legend className="text-sm font-medium">Do you have a dog?</legend>
              <div className="mt-1 flex gap-4 text-sm">
                {(["yes", "no"] as const).map((o) => <label key={o} className="flex items-center gap-2"><input type="radio" name="dog" checked={dog === o} onChange={() => setDog(o)} /> {o === "yes" ? "Yes" : "No"}</label>)}
              </div>
            </fieldset>
            <Field label="Are children in your videos? (optional)"><input className={INPUT} value={v.kids ?? ""} onChange={set("kids")} maxLength={200} /></Field>
            <Field label="Social profile (optional)"><input className={INPUT} value={v.social_url ?? ""} onChange={set("social_url")} maxLength={300} /></Field>
            <Field label="Another social profile (optional)"><input className={INPUT} value={v.additional_social_url ?? ""} onChange={set("additional_social_url")} maxLength={300} /></Field>
            <Field label="Anything else we should know? (optional)"><textarea className="mt-1 block w-full rounded-md border bg-background p-3" rows={3} value={v.notes ?? ""} onChange={set("notes")} maxLength={2000} /></Field>
          </>
        )}
        <Field label={headshot ? `Photo of you: ${headshot.name}` : "Photo of you (optional)"} hint="JPG, PNG or WebP, up to 5 MB.">
          <input type="file" accept={LIMITS.headshotTypes.join(",")} className="mt-1 block text-sm" disabled={!draft || busy} onChange={(e) => void pick("headshot", e.target.files)} />
        </Field>
        <Field label={`Videos (${videos.length} added, ${limits.min} to ${limits.max} needed)`} hint="MP4, MOV or WebM, up to 250 MB each.">
          <input type="file" multiple accept={LIMITS.videoTypes.join(",")} className="mt-1 block text-sm" disabled={!draft || busy} onChange={(e) => void pick("video", e.target.files)} />
        </Field>
        {videos.length > 0 && (
          <ul className="mt-2 text-sm text-muted-foreground" aria-label="Added videos">
            {videos.map((f) => (
              <li key={f.path}>{f.name} <button type="button" className="underline" onClick={() => setVideos((p) => p.filter((x) => x.path !== f.path))}>Remove</button></li>
            ))}
          </ul>
        )}
        <div aria-live="polite" className="mt-4 min-h-5 text-sm">{message && <span role="alert" className="text-destructive">{message}</span>}</div>
        <Button type="submit" size="lg" className="mt-2 h-12 w-full" disabled={busy || !draft}>{busy ? "Working" : "Send my application"}</Button>
      </form>
    </PublicShell>
  );
}
