// Early pages: builder-only list of the pages that are hidden from the menu, the Home cards and
// the Cmd+K palette until something feeds them (src/lib/hiddenPages.ts). Each row says what feeds
// the page and opens it. Nothing is lost: showing a page again is one line in that file.
import { Link } from "react-router-dom";
import { EmptyState, PageHeader, PageShell } from "@/components/page-kit";
import { useRolePrefix } from "@/hooks/useRolePath";
import { EARLY_PAGE_NOTES, HIDDEN_PAGES } from "@/lib/hiddenPages";

export default function EarlyPagesPage() {
  const prefix = useRolePrefix();
  const pages = HIDDEN_PAGES.map((key) => ({ key, note: EARLY_PAGE_NOTES[key] })).filter((p) => p.note);
  return (
    <PageShell data-testid="early-pages">
      <PageHeader
        title="Early pages"
        description="These pages are built but have no data yet, so they are left out of the menu until something feeds them. Only builders can open them."
      />
      {pages.length === 0 ? (
        <EmptyState title="No early pages" description="Every page is shown in the menu." />
      ) : (
        <ul className="space-y-2">
          {pages.map(({ key, note }) => (
            <li key={key} className="rounded border border-input p-3 text-sm" data-testid="early-page-row">
              <Link to={`${prefix}${note!.to}`} className="font-medium underline">
                {note!.label}
              </Link>
              <p className="mt-1 text-muted-foreground">{note!.feeds}</p>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
