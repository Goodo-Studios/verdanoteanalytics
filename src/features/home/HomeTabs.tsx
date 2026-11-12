// Tabs under Home: Today (the blocks), My work (my tasks in Goodo OS, OS-009) and Work (every
// client's ClickUp cards by due date).
import { Link } from "react-router-dom";
import { useRolePrefix } from "@/hooks/useRolePath";

const TAB = "whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors";
const ON = "border-verdant font-semibold text-forest";
const OFF = "border-transparent text-slate hover:text-forest";

export function HomeTabs({ active }: { active: "today" | "mine" | "work" }) {
  const prefix = useRolePrefix();
  const tabs = [
    { id: "today", label: "Today", to: `${prefix}/` },
    { id: "mine", label: "My work", to: `${prefix}/my-work` },
    { id: "work", label: "Work", to: `${prefix}/work` },
  ] as const;
  return (
    <nav aria-label="Home tabs" className="-mb-px flex gap-1 border-b border-border/60">
      {tabs.map((t) => (
        <Link key={t.id} to={t.to} aria-current={t.id === active ? "page" : undefined} className={`${TAB} ${t.id === active ? ON : OFF}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
