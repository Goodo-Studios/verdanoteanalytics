import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { useRolePrefix } from "@/hooks/useRolePath";
import { staffMenuSections, type StaffMenuItem } from "@/lib/staffMenu";

const CARD =
  "block rounded-lg border border-input bg-background px-4 py-3 font-body transition-colors";

function MenuCard({ item, prefix }: { item: StaffMenuItem; prefix: string }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-semibold text-forest">{item.title}</span>
        {item.status === "link" && <ExternalLink className="h-3.5 w-3.5 text-sage" aria-hidden="true" />}
        {item.status === "slot" && (
          <span className="rounded-full bg-muted px-2 py-0.5 font-label text-[9px] uppercase tracking-[0.1em] text-sage">
            {item.step ?? "Planned"}
          </span>
        )}
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">{item.description}</p>
    </>
  );

  if (item.status === "live" && item.to) {
    return (
      <Link to={`${prefix}${item.to}`} className={`${CARD} hover:bg-accent`} data-testid={`staff-menu-${item.id}`}>
        {body}
      </Link>
    );
  }
  if (item.status === "link" && item.href) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${CARD} hover:bg-accent`}
        data-testid={`staff-menu-${item.id}`}
      >
        {body}
      </a>
    );
  }
  // Slot: not built yet, so it is shown but not clickable.
  return (
    <div className={`${CARD} opacity-70`} aria-disabled="true" data-testid={`staff-menu-${item.id}`}>
      {body}
    </div>
  );
}

export default function StaffHomePage() {
  const { isBuilder } = useAuth();
  const { isClientPreview, isEmployeePreview } = useClientPreview();
  // Builder-only entries follow the same rule as the sidebar: a real builder, not previewing another role.
  const effectiveBuilder = isBuilder && !isClientPreview && !isEmployeePreview;
  const prefix = useRolePrefix();

  return (
    <div className="space-y-8">
      <PageHeader title="Staff menu" description="Every internal tool in one place." />
      {staffMenuSections.map((section) => {
        const items = section.items.filter((i) => effectiveBuilder || !i.builderOnly);
        if (items.length === 0) return null;
        return (
          <section key={section.id} aria-labelledby={`staff-section-${section.id}`} className="space-y-3">
            <div>
              <h2 id={`staff-section-${section.id}`} className="font-heading text-[16px] font-semibold text-forest">
                {section.label}
              </h2>
              <p className="font-body text-[12px] text-muted-foreground">{section.blurb}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <MenuCard key={item.id} item={item} prefix={prefix} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
