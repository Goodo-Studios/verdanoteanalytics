// Staff Home. The front door of the staff area: the client you are working on, a way into each
// part of the app, and links to the apps that stay outside Verdanote. Clients never see this
// page; their index is the Overview.
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { useRolePrefix } from "@/hooks/useRolePath";
import { SECTIONS } from "@/lib/sections";
import { ATTIO_URL, GOODO_TIME_URL, OLD_DASHBOARD_PUBLIC_URL } from "@/lib/staffMenu";

const CARD = "block rounded-lg border border-input bg-background px-4 py-3 font-body transition-colors hover:bg-accent";

const OTHER_APPS = [
  { id: "goodo-time", title: "Goodo Time", description: "Time tracking for the team.", href: GOODO_TIME_URL },
  { id: "attio", title: "Attio", description: "Leads and relationships.", href: ATTIO_URL },
  {
    id: "old-dashboard-public",
    title: "Old dashboard public pages",
    description: "Application forms and client, talent and crew links, until they move.",
    href: OLD_DASHBOARD_PUBLIC_URL,
  },
];

export default function HomePage() {
  const prefix = useRolePrefix();
  const { selectedClient, selectedSlug } = useClientSelection();

  const cards = [
    { id: "clients", title: "Clients", description: "Every client, with a page for each: work, briefs, performance, brand document, meetings and scope.", to: "/clients" },
    ...SECTIONS.map((s) => ({ id: s.id, title: s.label, description: s.description, to: `/${s.id}` })),
  ];

  return (
    <div className="space-y-6 p-6" data-testid="home-page">
      <PageHeader title="Home" description="Pick a client at the top of the page, or go straight to a part of the app." />

      <section aria-label="Current client" className="rounded-lg border border-input p-4">
        {selectedSlug ? (
          <p className="text-sm">
            You are working on <span className="font-semibold">{selectedClient?.name ?? selectedSlug}</span>.{" "}
            <Link to={`${prefix}/clients/${encodeURIComponent(selectedSlug)}`} className="underline" data-testid="home-open-client">
              Open this client
            </Link>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No client picked. The pages that work on one client ask you to pick one in the switcher at the top.
          </p>
        )}
      </section>

      <section aria-label="Menu" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.id} to={`${prefix}${c.to}`} className={CARD} data-testid={`home-card-${c.id}`}>
            <span className="text-[14px] font-semibold text-forest">{c.title}</span>
            <p className="mt-1 text-[12px] text-muted-foreground">{c.description}</p>
          </Link>
        ))}
      </section>

      <section aria-label="Other apps" className="space-y-2">
        <h2 className="text-sm font-semibold">Other apps</h2>
        <p className="text-xs text-muted-foreground">These stay outside Verdanote and open in a new tab.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {OTHER_APPS.map((a) => (
            <a key={a.id} href={a.href} target="_blank" rel="noopener noreferrer" className={CARD} data-testid={`home-app-${a.id}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-semibold text-forest">{a.title}</span>
                <ExternalLink className="h-3.5 w-3.5 text-sage" aria-hidden="true" />
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">{a.description}</p>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
