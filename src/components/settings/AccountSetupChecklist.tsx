import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, ExternalLink, Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

interface ChecklistItem {
  id: string;
  completed: boolean;
  completed_at: string | null;
}

interface ChecklistDef {
  id: string;
  label: string;
  description: string;
  link: string | null;
  tab?: string;
  autoOnly?: boolean;
}

const CHECKLIST_ITEMS: ChecklistDef[] = [
  { id: "connect_meta", label: "Connect Meta account", description: "Auto-checked when first sync completes", link: null, autoOnly: true },
  { id: "run_first_sync", label: "Run first sync", description: "Auto-checked when creatives are fetched", link: null, autoOnly: true },
  { id: "set_scale_threshold", label: "Set scale threshold", description: "Define when to scale a creative", link: null, tab: "scoring" },
  { id: "set_kill_threshold", label: "Set kill threshold", description: "Define when to kill a creative", link: null, tab: "scoring" },
  { id: "set_monthly_spend", label: "Set monthly spend target", description: "Used for pacing and goals", link: null, tab: "account" },
  { id: "write_brand_brief", label: "Write brand brief", description: "Helps the AI understand this account", link: null, tab: "context" },
  { id: "add_creative_rules", label: "Add 3 creative rules", description: "Do's and don'ts for creative output", link: null, tab: "context" },
  { id: "tag_top_creatives", label: "Tag top 20 creatives", description: "Tag your highest-spend creatives", link: "/tagging" },
  { id: "setup_competitor", label: "Set up at least 1 competitor", description: "Track competitor ad libraries", link: "/competitors" },
];

function useOnboardingChecklist(accountId: string) {
  return useQuery({
    queryKey: ["onboarding-checklist", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_context")
        .select("onboarding_checklist")
        .eq("account_id", accountId)
        .maybeSingle();
      if (error) throw error;
      return ((data?.onboarding_checklist as any) || []) as ChecklistItem[];
    },
    enabled: !!accountId,
  });
}

function useSaveChecklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, checklist }: { accountId: string; checklist: ChecklistItem[] }) => {
      const { error } = await supabase
        .from("account_context")
        .upsert(
          { account_id: accountId, onboarding_checklist: checklist as any, updated_at: new Date().toISOString() },
          { onConflict: "account_id" }
        );
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-checklist", vars.accountId] });
    },
    onError: (e: any) => toast.error("Failed to save checklist", { description: e.message }),
  });
}

interface Props {
  account: any;
  onSwitchTab?: (tab: string) => void;
}

export function AccountSetupChecklist({ account, onSwitchTab }: Props) {
  const { data: saved, isLoading } = useOnboardingChecklist(account.id);
  const save = useSaveChecklist();
  const navigate = useNavigate();

  const checklist = useMemo(() => {
    const items: ChecklistItem[] = CHECKLIST_ITEMS.map((def) => {
      const existing = (saved || []).find((s) => s.id === def.id);
      return existing || { id: def.id, completed: false, completed_at: null };
    });

    // Auto-check based on account state
    const autoChecks: Record<string, boolean> = {
      connect_meta: !!account.last_synced_at,
      run_first_sync: (account.creative_count || 0) > 0,
      set_scale_threshold: account.scale_threshold != null && account.scale_threshold !== 2.0,
      set_kill_threshold: account.kill_threshold != null && account.kill_threshold !== 1.0,
      set_monthly_spend: account.target_monthly_spend != null && account.target_monthly_spend > 0,
    };

    return items.map((item) => {
      if (autoChecks[item.id] && !item.completed) {
        return { ...item, completed: true, completed_at: new Date().toISOString() };
      }
      return item;
    });
  }, [saved, account]);

  const completedCount = checklist.filter((c) => c.completed).length;
  const totalCount = checklist.length;
  const progressPct = Math.round((completedCount / totalCount) * 100);

  const toggleItem = useCallback((id: string) => {
    const def = CHECKLIST_ITEMS.find((d) => d.id === id);
    if (def?.autoOnly) return; // Can't manually toggle auto items

    const updated = checklist.map((item) =>
      item.id === id
        ? { ...item, completed: !item.completed, completed_at: !item.completed ? new Date().toISOString() : null }
        : item
    );
    save.mutate({ accountId: account.id, checklist: updated });
  }, [checklist, account.id, save]);

  const handleNavigate = useCallback((item: ChecklistDef) => {
    if (item.tab && onSwitchTab) {
      onSwitchTab(item.tab);
    } else if (item.link) {
      navigate(item.link);
    }
  }, [navigate, onSwitchTab]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Progress header */}
      <div className="glass-panel p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Rocket className="h-5 w-5 text-verdant" />
          <div>
            <h2 className="font-heading text-[18px] text-forest">Account Setup</h2>
            <p className="font-body text-[12px] text-muted-foreground">
              Complete these steps to get the most out of {account.name}.
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-body text-[12px] text-muted-foreground">
              {completedCount} of {totalCount} completed
            </span>
            <span className="font-data text-[14px] font-semibold text-forest">{progressPct}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-verdant rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {completedCount === totalCount && (
          <div className="bg-verdant/10 border border-verdant/30 rounded-md p-3 text-center">
            <span className="font-body text-[13px] font-medium text-verdant">
              🎉 All setup steps completed! You're ready to go.
            </span>
          </div>
        )}
      </div>

      {/* Checklist */}
      <div className="glass-panel divide-y divide-border/50">
        {CHECKLIST_ITEMS.map((def, idx) => {
          const item = checklist.find((c) => c.id === def.id)!;
          const isCompleted = item.completed;

          return (
            <div
              key={def.id}
              className={cn(
                "flex items-center gap-3 px-5 py-3.5 transition-colors",
                isCompleted ? "opacity-60" : "hover:bg-muted/30"
              )}
            >
              <button
                onClick={() => toggleItem(def.id)}
                disabled={def.autoOnly}
                className={cn(
                  "shrink-0 transition-colors",
                  def.autoOnly && "cursor-default"
                )}
              >
                {isCompleted ? (
                  <CheckCircle2 className="h-5 w-5 text-verdant" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground/40" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <div className={cn(
                  "font-body text-[13px] font-medium",
                  isCompleted ? "text-muted-foreground line-through" : "text-charcoal"
                )}>
                  {def.label}
                </div>
                <div className="font-body text-[11px] text-muted-foreground">{def.description}</div>
              </div>

              {!isCompleted && (def.tab || def.link) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 h-7 gap-1 font-body text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => handleNavigate(def)}
                >
                  Go <ExternalLink className="h-3 w-3" />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Hook to detect if account needs onboarding (for auto-show modal)
export function useAccountNeedsOnboarding(account: any) {
  const { data: checklist } = useOnboardingChecklist(account?.id);
  
  if (!account) return false;
  
  const items = checklist || [];
  // Show if no checklist saved yet AND account has just completed its first sync
  if (items.length === 0 && account.last_synced_at && account.creative_count > 0) {
    // Check if this is a new account (synced within last hour)
    const syncedAt = new Date(account.last_synced_at).getTime();
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    return syncedAt > oneHourAgo;
  }
  
  // Also show if less than 30% complete
  if (items.length > 0) {
    const completed = items.filter((i) => i.completed).length;
    return completed / CHECKLIST_ITEMS.length < 0.3;
  }
  
  return false;
}
