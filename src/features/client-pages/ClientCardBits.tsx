// Small shared pieces for the client pages (OS-019). Calm War Room look: cards, no tables, red only
// for a late due date.
import type { ReactNode } from "react";
import { dueText } from "@/lib/clientPages";

export function DueLabel({ due, today }: { due: string | null; today: string }) {
  const d = dueText(due, today);
  return (
    <span
      className={d.late ? "text-xs font-medium text-[var(--gos-late)]" : "text-xs text-muted-foreground"}
      data-testid="client-card-due"
      data-late={d.late ? "true" : undefined}
    >
      {d.text}
    </span>
  );
}

export function ClientCardShell({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <article
      className="rounded-[var(--gos-radius-card,20px)] border border-[var(--gos-line,#e9e5de)] bg-card p-5 shadow-[var(--gos-shadow)]"
      data-testid={testId}
    >
      {children}
    </article>
  );
}

export function PageIntro({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-6">
      <h1 className="font-heading text-[24px] text-forest sm:text-[32px]">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </header>
  );
}

/** Opens the asset in a new tab. Only http(s) links reach here (toClientCards drops anything else). */
export function AssetLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-verdant underline-offset-2 hover:underline">
      {children}
    </a>
  );
}
