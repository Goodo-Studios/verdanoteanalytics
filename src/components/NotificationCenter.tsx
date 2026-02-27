import { useState, useRef, useEffect } from "react";
import { Bell, CheckCheck, TrendingUp, TrendingDown, RefreshCw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotifications, useMarkNotificationRead, useMarkAllRead, type Notification } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

const TYPE_CONFIG: Record<string, { icon: typeof Info; className: string }> = {
  winner: { icon: TrendingUp, className: "text-verdant" },
  concern: { icon: TrendingDown, className: "text-destructive" },
  sync: { icon: RefreshCw, className: "text-primary" },
  info: { icon: Info, className: "text-slate" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: notifications = [] } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllRead();

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const today = notifications.filter((n) => isToday(n.created_at));
  const earlier = notifications.filter((n) => !isToday(n.created_at));

  const renderItem = (n: Notification) => {
    const config = TYPE_CONFIG[n.type] || TYPE_CONFIG.info;
    const Icon = config.icon;
    return (
      <button
        key={n.id}
        onClick={() => { if (!n.read) markRead.mutate(n.id); }}
        className={cn(
          "w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors rounded-md",
          n.read ? "opacity-60" : "bg-primary/5 hover:bg-primary/10"
        )}
      >
        <Icon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", config.className)} />
        <div className="min-w-0 flex-1">
          <p className="font-body text-[13px] font-medium text-charcoal leading-tight">{n.title}</p>
          {n.body && (
            <p className="font-body text-[11px] text-slate mt-0.5 leading-snug">
              {n.body.length > 80 ? n.body.slice(0, 80) + "…" : n.body}
            </p>
          )}
          <p className="font-body text-[10px] text-sage mt-1">{timeAgo(n.created_at)}</p>
        </div>
        {!n.read && <span className="h-2 w-2 rounded-full bg-verdant flex-shrink-0 mt-1.5" />}
      </button>
    );
  };

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 relative"
        onClick={() => setOpen(!open)}
      >
        <Bell className="h-4.5 w-4.5 text-slate" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] rounded-full bg-destructive text-[10px] font-semibold text-white flex items-center justify-center px-1">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-background border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <h3 className="font-heading text-[14px] text-forest">Notifications</h3>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 font-body text-[11px] text-sage hover:text-charcoal gap-1"
                onClick={() => markAllRead.mutate()}
              >
                <CheckCheck className="h-3 w-3" /> Mark all read
              </Button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-10 text-center">
                <Bell className="h-6 w-6 text-sage mx-auto mb-2 opacity-50" />
                <p className="font-body text-[13px] text-sage">No notifications yet</p>
              </div>
            ) : (
              <>
                {today.length > 0 && (
                  <div>
                    <p className="font-label text-[10px] uppercase tracking-wide text-sage px-3 pt-2.5 pb-1">Today</p>
                    {today.map(renderItem)}
                  </div>
                )}
                {earlier.length > 0 && (
                  <div>
                    <p className="font-label text-[10px] uppercase tracking-wide text-sage px-3 pt-2.5 pb-1">Earlier</p>
                    {earlier.map(renderItem)}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
