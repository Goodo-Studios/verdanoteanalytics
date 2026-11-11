// The page a client opens from a location link: the shared locations with photos. View only.
import { useParams } from "react-router-dom";
import { PublicLinkFailure } from "./PublicLinkFailure";
import { PublicShell } from "./PublicShell";
import { usePublicLink } from "./usePublicLink";

interface Board {
  label: string | null;
  client_name: string;
  locations: { location_id: string; name: string; neighborhood: string | null; rental_type: string | null; rooms: string[]; attributes: string[]; photos: { id: string; caption: string | null; url: string | null }[] }[];
}

export default function PublicLocationBoardPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { data, failure, reload } = usePublicLink<Board>("location", token);
  if (failure && !data) return <PublicLinkFailure failure={failure} onRetry={() => void reload()} />;
  if (!data) return <PublicShell title="Loading"><p role="status" className="text-muted-foreground">Loading your page</p></PublicShell>;
  return (
    <PublicShell title={data.label || (data.client_name ? `Locations for ${data.client_name}` : "Locations")}>
      <p className="text-muted-foreground">Here are the locations we picked out. Tell your Goodo contact which ones you like.</p>
      {data.locations.length === 0 ? <p className="mt-4 text-muted-foreground">No locations are on this page yet.</p> : (
        <ul className="mt-4 space-y-6">
          {data.locations.map((l) => (
            <li key={l.location_id} className="rounded-xl border bg-card p-4 shadow-sm" data-testid={`location-${l.location_id}`}>
              <h2 className="text-lg font-semibold">{l.name}</h2>
              <p className="text-sm text-muted-foreground">{[l.neighborhood, l.rental_type].filter(Boolean).join(" · ")}</p>
              {l.rooms.length > 0 && <p className="mt-2 text-sm"><span className="font-medium">Rooms:</span> {l.rooms.join(", ")}</p>}
              {l.attributes.length > 0 && <p className="mt-1 text-sm"><span className="font-medium">Good to know:</span> {l.attributes.join(", ")}</p>}
              {l.photos.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {l.photos.filter((p) => p.url).map((p) => <img key={p.id} src={p.url!} alt={p.caption || l.name} loading="lazy" className="aspect-[4/3] w-full rounded object-cover" />)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </PublicShell>
  );
}
