import { usePresence, PresenceUser } from "@/hooks/usePresence";
import { useAccountContext } from "@/contexts/AccountContext";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const PAGE_LABELS: Record<string, string> = {
  "/": "Overview",
  "/creatives": "Creatives",
  "/analytics": "Analytics",
  "/reports": "Reports",
  "/settings": "Settings",
  "/tagging": "Tagging",
  "/compare": "Compare",
  "/briefs": "Briefs",
  "/calendar": "Calendar",
};

function getPageLabel(path: string) {
  return PAGE_LABELS[path] || path.replace("/", "").replace(/-/g, " ") || "Overview";
}

function getInitials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

const COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500",
  "bg-pink-500", "bg-cyan-500", "bg-rose-500", "bg-indigo-500",
];

function colorForUser(userId: string) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash << 5) - hash + userId.charCodeAt(i);
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function PresenceAvatars() {
  const { selectedAccountId } = useAccountContext();
  const users = usePresence(selectedAccountId);

  if (users.length === 0) return null;

  const shown = users.slice(0, 3);
  const extra = users.length - 3;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center -space-x-2">
            {shown.map((u) => (
              <div
                key={u.user_id}
                className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold ring-2 ring-background",
                  colorForUser(u.user_id),
                )}
              >
                {getInitials(u.name)}
              </div>
            ))}
            {extra > 0 && (
              <div className="h-7 w-7 rounded-full flex items-center justify-center bg-muted text-muted-foreground text-[10px] font-bold ring-2 ring-background">
                +{extra}
              </div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="space-y-1 p-2.5">
          <p className="font-label text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Also viewing this account
          </p>
          {users.map((u) => (
            <div key={u.user_id} className="flex items-center gap-2">
              <div className={cn("h-5 w-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold", colorForUser(u.user_id))}>
                {getInitials(u.name)}
              </div>
              <div>
                <span className="font-body text-[12px] text-foreground font-medium">{u.name}</span>
                <span className="font-body text-[11px] text-muted-foreground ml-1.5">
                  on {getPageLabel(u.current_page)}
                </span>
              </div>
            </div>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
