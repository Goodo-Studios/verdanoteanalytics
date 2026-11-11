// The page a client or talent reviewer opens from an approval or casting link. No login, no
// staff menu, nothing that links into the app. It reads and writes only through the public-link
// function with the secret in the address. Phone first: one card per person, large buttons.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FAILURE_COPY, callPublicLink, safeHref, type LinkFailure, type LinkType } from "./publicLinkApi";
import { PublicShell } from "./PublicShell";

interface Video { id: string; title: string | null; format?: string | null; url: string | null; thumbnail_url: string | null }
interface Photo { id: string; caption?: string | null; category?: string | null; label?: string | null }
interface Person {
  assignment_id: string;
  name: string;
  vote: "up" | "down" | null;
  videos: Video[];
  gender?: string | null;
  age_range?: string[];
  headshot_url?: string | null;
  photos?: Photo[];
  family_pet_photos?: Photo[];
  filming_location_photos?: Photo[];
  social_url?: string | null;
  additional_social_url?: string | null;
}
interface Board { client_name: string; expires_at: string | null; people: Person[] }

const NAME_KEY = "goodo-reviewer-name";
const readName = (): string => {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
};
const saveName = (v: string) => {
  try {
    window.localStorage.setItem(NAME_KEY, v);
  } catch {
    // Private browsing: the name stays on the page only.
  }
};

function PhotoButton({ type, token, kind, photo }: { type: LinkType; token: string; kind: "photo" | "location"; photo: Photo }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const label = photo.caption || photo.label || photo.category || "Photo";
  useEffect(() => {
    let live = true;
    void callPublicLink<{ url: string }>({ type, action: "photo", token, kind, id: photo.id }).then((r) => {
      if (!live) return;
      if (r.ok) setUrl(r.data.url);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [type, token, kind, photo.id]);
  if (failed) return <span className="text-xs text-muted-foreground">{label} could not load</span>;
  if (!url) return <span className="inline-block h-24 w-24 rounded bg-muted" aria-label={`${label} loading`} />;
  return <img src={url} alt={label} loading="lazy" className="h-24 w-24 rounded object-cover" />;
}

function PersonCard({ person, type, token, onVote, busy }: { person: Person; type: LinkType; token: string; onVote: (p: Person, v: "up" | "down") => void; busy: boolean }) {
  const [showPhotos, setShowPhotos] = useState(false);
  const photos: { photo: Photo; kind: "photo" | "location" }[] = [
    ...(person.photos ?? []).map((photo) => ({ photo, kind: "photo" as const })),
    ...(person.family_pet_photos ?? []).map((photo) => ({ photo, kind: "photo" as const })),
    ...(person.filming_location_photos ?? []).map((photo) => ({ photo, kind: "location" as const })),
  ];
  const links = [safeHref(person.social_url), safeHref(person.additional_social_url)].filter((x): x is string => !!x);
  const facts = [person.gender, person.age_range?.length ? person.age_range.join(", ") : null].filter(Boolean).join(" · ");
  return (
    <li className="rounded-xl border bg-card p-4 shadow-sm" data-testid={`person-${person.assignment_id}`}>
      <div className="flex items-center gap-3">
        {person.headshot_url && <img src={person.headshot_url} alt="" className="h-14 w-14 rounded-full object-cover" />}
        <div>
          <h2 className="text-lg font-semibold">{person.name}</h2>
          {facts && <p className="text-sm text-muted-foreground">{facts}</p>}
        </div>
      </div>
      {person.videos.length > 0 && (
        <div className="mt-3 space-y-3">
          {person.videos.map((v) => v.url && (
            <figure key={v.id}>
              <video controls preload="none" playsInline poster={v.thumbnail_url ?? undefined} className="w-full rounded-lg bg-black" src={v.url} aria-label={v.title ?? `Video from ${person.name}`} />
              {v.title && <figcaption className="mt-1 text-xs text-muted-foreground">{v.title}</figcaption>}
            </figure>
          ))}
        </div>
      )}
      {links.length > 0 && (
        <p className="mt-2 text-sm">
          {links.map((href) => <a key={href} href={href} target="_blank" rel="noopener noreferrer nofollow" className="mr-3 underline">Social profile</a>)}
        </p>
      )}
      {photos.length > 0 && (
        <div className="mt-2">
          <button type="button" className="text-sm underline" onClick={() => setShowPhotos((s) => !s)}>
            {showPhotos ? "Hide photos" : `Show ${photos.length} photo${photos.length === 1 ? "" : "s"}`}
          </button>
          {showPhotos && <div className="mt-2 flex flex-wrap gap-2">{photos.map((p) => <PhotoButton key={`${p.kind}-${p.photo.id}`} type={type} token={token} kind={p.kind} photo={p.photo} />)}</div>}
        </div>
      )}
      <div className="mt-4 flex gap-3">
        <Button type="button" size="lg" className="h-12 flex-1" variant={person.vote === "up" ? "default" : "outline"} disabled={busy} aria-pressed={person.vote === "up"} onClick={() => onVote(person, "up")}>
          <ThumbsUp className="mr-2 h-5 w-5" aria-hidden /> Yes
        </Button>
        <Button type="button" size="lg" className="h-12 flex-1" variant={person.vote === "down" ? "default" : "outline"} disabled={busy} aria-pressed={person.vote === "down"} onClick={() => onVote(person, "down")}>
          <ThumbsDown className="mr-2 h-5 w-5" aria-hidden /> No thanks
        </Button>
      </div>
    </li>
  );
}

export default function PublicBoardPage({ type }: { type: LinkType }) {
  const { token = "" } = useParams<{ token: string }>();
  const [board, setBoard] = useState<Board | null>(null);
  const [failure, setFailure] = useState<LinkFailure | null>(null);
  const [voteFailure, setVoteFailure] = useState<LinkFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(readName);

  const load = useCallback(async () => {
    setFailure(null);
    const r = await callPublicLink<Board>({ type, action: "get", token });
    if (r.ok) setBoard(r.data);
    else setFailure(r.reason);
  }, [type, token]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  const vote = async (p: Person, v: "up" | "down") => {
    setBusy(true);
    setVoteFailure(null);
    setSaved(false);
    const r = await callPublicLink<{ ok: true }>({ type, action: "vote", token, assignment_id: p.assignment_id, vote: v, voted_by: name.trim() || null });
    setBusy(false);
    if (!r.ok) {
      if (r.reason === "revoked" || r.reason === "expired" || r.reason === "not_found") setFailure(r.reason);
      else setVoteFailure(r.reason);
      return;
    }
    setBoard((b) => (b ? { ...b, people: b.people.map((x) => (x.assignment_id === p.assignment_id ? { ...x, vote: v } : x)) } : b));
    setSaved(true);
  };

  const heading = type === "approval" ? "Creators for your review" : "Talent for your review";
  const intro = type === "approval"
    ? "Tap Yes for creators you would like to work with, or No thanks to pass. You can change your mind any time while this link is open."
    : "Tap Yes for talent you would like to book, or No thanks to pass. You can change your mind any time while this link is open.";

  if (failure && !board) {
    const copy = FAILURE_COPY[failure];
    return (
      <PublicShell title={copy.title}>
        <p role="alert" className="text-muted-foreground">{copy.body}</p>
        {(failure === "error" || failure === "rate_limited") && <Button type="button" className="mt-4" onClick={() => void load()}>Try again</Button>}
      </PublicShell>
    );
  }
  if (!board) {
    return <PublicShell title="Loading"><p role="status" className="text-muted-foreground">Loading your page</p></PublicShell>;
  }
  const decided = board.people.filter((p) => p.vote).length;
  return (
    <PublicShell title={board.client_name ? `${heading} · ${board.client_name}` : heading}>
      <p className="text-muted-foreground">{intro}</p>
      <label className="mt-4 block text-sm">
        Your first name (optional)
        <input
          value={name}
          maxLength={40}
          onChange={(e) => { setName(e.target.value); saveName(e.target.value); }}
          className="mt-1 block h-11 w-full rounded-md border bg-background px-3"
          autoComplete="given-name"
        />
      </label>
      <p className="mt-4 text-sm font-medium" data-testid="progress">{decided} of {board.people.length} answered</p>
      <div aria-live="polite" className="min-h-5 text-sm">
        {saved && <span data-testid="saved" className="text-muted-foreground">Saved. Thank you.</span>}
        {voteFailure && <span role="alert" className="text-destructive">{FAILURE_COPY[voteFailure].title}. {FAILURE_COPY[voteFailure].body}</span>}
        {failure && board && <span role="alert" className="text-destructive">{FAILURE_COPY[failure].title}. {FAILURE_COPY[failure].body}</span>}
      </div>
      {board.people.length === 0 ? (
        <p className="mt-4 text-muted-foreground">Nobody is on this page yet. Check back soon.</p>
      ) : (
        <ul className="mt-2 space-y-4">
          {board.people.map((p) => <PersonCard key={p.assignment_id} person={p} type={type} token={token} onVote={(x, v) => void vote(x, v)} busy={busy} />)}
        </ul>
      )}
    </PublicShell>
  );
}
