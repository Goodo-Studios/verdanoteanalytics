// The frame every public link page sits in: Goodo Studios branding and a single column.
// It has no staff menu, no sign-in prompt and no link into the app on purpose.
import type { ReactNode } from "react";

export function PublicShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="public-shell">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-2xl items-center px-4 py-3">
          <span className="text-sm font-semibold tracking-wide">Goodo Studios</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="mb-3 text-2xl font-semibold">{title}</h1>
        {children}
      </main>
    </div>
  );
}
