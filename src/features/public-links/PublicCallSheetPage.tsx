// The page crew and talent open from a call sheet link. View only.
import { useParams } from "react-router-dom";
import { PublicLinkFailure } from "./PublicLinkFailure";
import { PublicShell } from "./PublicShell";
import { usePublicLink } from "./usePublicLink";

interface Sheet {
  call_time: string | null;
  wrap_time_estimate: string | null;
  general_notes: string | null;
  shoot_date: string | null;
  shoot_location: string | null;
  client_name: string;
  talent: { name: string; phone: string | null; email: string | null }[];
  location: { name: string | null; neighborhood: string | null; parking_instructions: string | null; wifi_name: string | null; wifi_password: string | null; entry_instructions: string | null; contact_name: string | null; contact_email: string | null } | null;
  schedule: { id: string; label: string; start_time: string; end_time: string; location: string | null; notes: string | null; talent: { name: string }[]; crew: { id: string; name: string }[] }[];
  crew: { id: string; name: string; role: string | null; phone: string | null; email: string | null }[];
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "");

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return value ? <p className="text-sm"><span className="font-medium">{label}:</span> {value}</p> : null;
}

export default function PublicCallSheetPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { data, failure, reload } = usePublicLink<Sheet>("call-sheet", token);
  if (failure && !data) return <PublicLinkFailure failure={failure} onRetry={() => void reload()} />;
  if (!data) return <PublicShell title="Loading"><p role="status" className="text-muted-foreground">Loading your page</p></PublicShell>;
  const loc = data.location;
  return (
    <PublicShell title={data.client_name ? `Call sheet for ${data.client_name}` : "Call sheet"}>
      <section className="rounded-xl border bg-card p-4" aria-label="The day">
        <p className="text-lg font-semibold">{day(data.shoot_date)}</p>
        <Row label="Call time" value={hhmm(data.call_time)} />
        <Row label="Expected wrap" value={data.wrap_time_estimate} />
        <Row label="Where" value={data.shoot_location} />
        {data.general_notes && <p className="mt-2 whitespace-pre-wrap text-sm">{data.general_notes}</p>}
      </section>
      {loc && (
        <section className="mt-4 rounded-xl border bg-card p-4" aria-label="Location">
          <h2 className="font-semibold">{loc.name}</h2>
          <Row label="Neighborhood" value={loc.neighborhood} />
          <Row label="Parking" value={loc.parking_instructions} />
          <Row label="Getting in" value={loc.entry_instructions} />
          <Row label="Wifi" value={loc.wifi_name} />
          <Row label="Wifi password" value={loc.wifi_password} />
          <Row label="Host" value={[loc.contact_name, loc.contact_email].filter(Boolean).join(", ")} />
        </section>
      )}
      {data.schedule.length > 0 && (
        <section className="mt-4 rounded-xl border bg-card p-4" aria-label="Schedule">
          <h2 className="font-semibold">Schedule</h2>
          <ul className="mt-2 space-y-3">
            {data.schedule.map((b) => (
              <li key={b.id} className="text-sm">
                <p className="font-medium">{hhmm(b.start_time)} to {hhmm(b.end_time)} · {b.label}</p>
                <Row label="Where" value={b.location} />
                <Row label="Talent" value={b.talent.map((t) => t.name).join(", ")} />
                <Row label="Crew" value={b.crew.map((c) => c.name).join(", ")} />
                {b.notes && <p className="whitespace-pre-wrap">{b.notes}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.talent.length > 0 && (
        <section className="mt-4 rounded-xl border bg-card p-4" aria-label="Talent">
          <h2 className="font-semibold">Talent</h2>
          <ul className="mt-2 space-y-1 text-sm">{data.talent.map((t, i) => <li key={i}>{t.name}{t.phone ? ` · ${t.phone}` : ""}{t.email ? ` · ${t.email}` : ""}</li>)}</ul>
        </section>
      )}
      {data.crew.length > 0 && (
        <section className="mt-4 rounded-xl border bg-card p-4" aria-label="Crew">
          <h2 className="font-semibold">Crew</h2>
          <ul className="mt-2 space-y-1 text-sm">{data.crew.map((c) => <li key={c.id}>{c.name}{c.role ? ` (${c.role})` : ""}{c.phone ? ` · ${c.phone}` : ""}{c.email ? ` · ${c.email}` : ""}</li>)}</ul>
        </section>
      )}
    </PublicShell>
  );
}
