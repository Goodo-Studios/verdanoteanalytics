import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Zap, Layers, Sparkles, LayoutGrid, FileText, Award,
  Bell, TrendingUp, Calendar, ArrowRight, Check, Leaf,
} from "lucide-react";

type AppRole = "builder" | "employee" | "client" | "editor";

interface Props {
  open: boolean;
  onClose: () => void;
}

/* ── role-specific content ───────────────── */

const subtitles: Record<AppRole, string> = {
  builder: "Your creative analytics command center is ready.",
  employee: "Your team's creative performance data is live.",
  editor: "See how your work is performing in real ads.",
  client: "Your creative results, all in one place.",
};

interface Feature { icon: React.ReactNode; title: string; description: string }

const tourFeatures: Record<AppRole, Feature[]> = {
  builder: [
    { icon: <Zap className="h-5 w-5 text-verdant" />, title: "Creatives", description: "See every ad and what's working" },
    { icon: <Layers className="h-5 w-5 text-verdant" />, title: "Concepts", description: "Group iterations and find your winners" },
    { icon: <Sparkles className="h-5 w-5 text-verdant" />, title: "AI Analyst", description: "Ask questions about your data in plain English" },
  ],
  employee: [
    { icon: <Zap className="h-5 w-5 text-verdant" />, title: "Creatives", description: "See every ad and what's working" },
    { icon: <Layers className="h-5 w-5 text-verdant" />, title: "Concepts", description: "Group iterations and find your winners" },
    { icon: <Sparkles className="h-5 w-5 text-verdant" />, title: "AI Analyst", description: "Ask questions about your data in plain English" },
  ],
  editor: [
    { icon: <Zap className="h-5 w-5 text-verdant" />, title: "Your Creatives", description: "See your edits and their performance" },
    { icon: <Award className="h-5 w-5 text-verdant" />, title: "The Score", description: "Understand what makes an ad convert" },
  ],
  client: [
    { icon: <LayoutGrid className="h-5 w-5 text-verdant" />, title: "Overview", description: "Your results at a glance" },
    { icon: <FileText className="h-5 w-5 text-verdant" />, title: "Reports", description: "Deep dives from your team" },
  ],
};

const hasNotificationStep = (role: AppRole | null) => role === "builder" || role === "employee";

/* ── main component ──────────────────────── */

export function OnboardingWizard({ open, onClose }: Props) {
  const { role, user } = useAuth();
  const safeRole = (role || "client") as AppRole;

  const totalSteps = hasNotificationStep(role) ? 4 : 3;
  const [step, setStep] = useState(0);

  const [notifScale, setNotifScale] = useState(true);
  const [notifKill, setNotifKill] = useState(true);
  const [notifWeekly, setNotifWeekly] = useState(true);

  const markComplete = useCallback(async () => {
    if (!user?.id) return;
    await supabase
      .from("user_preferences" as any)
      .upsert(
        { user_id: user.id, first_login: false, updated_at: new Date().toISOString() } as any,
        { onConflict: "user_id" },
      );
    onClose();
  }, [user?.id, onClose]);

  const next = () => {
    if (step < totalSteps - 1) {
      // Skip notification step for editor/client
      if (step === 1 && !hasNotificationStep(role)) {
        setStep(totalSteps - 1);
      } else {
        setStep(step + 1);
      }
    } else {
      markComplete();
    }
  };

  const dots = Array.from({ length: totalSteps }, (_, i) => i);

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-[480px] p-0 gap-0 overflow-hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Progress dots */}
        <div className="flex justify-center gap-2 pt-8 pb-2">
          {dots.map((i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? "w-6 bg-verdant" : i < step ? "w-1.5 bg-verdant/40" : "w-1.5 bg-border"
              }`}
            />
          ))}
        </div>

        <div className="px-8 pb-8 pt-4">
          {/* Step 0: Welcome */}
          {step === 0 && (
            <div className="text-center space-y-4">
              <div className="h-14 w-14 rounded-lg mx-auto flex items-center justify-center bg-sage-light/50">
                <Leaf className="h-7 w-7 text-verdant" />
              </div>
              <DialogTitle className="font-heading text-[24px] text-forest">
                Welcome to Verdanote
              </DialogTitle>
              <DialogDescription className="font-body text-[14px] text-slate">
                {subtitles[safeRole]}
              </DialogDescription>
            </div>
          )}

          {/* Step 1: Quick Tour */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="text-center">
                <DialogTitle className="font-heading text-[20px] text-forest">
                  Here's what you can do
                </DialogTitle>
                <DialogDescription className="font-body text-[13px] text-slate mt-1">
                  A quick look at your key tools.
                </DialogDescription>
              </div>
              <div className="space-y-3">
                {tourFeatures[safeRole].map((f, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-sage-light/30 border border-border-light">
                    <div className="shrink-0 mt-0.5">{f.icon}</div>
                    <div>
                      <p className="font-body text-[14px] font-semibold text-forest">{f.title}</p>
                      <p className="font-body text-[12px] text-slate">{f.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Notifications (builder/employee only) */}
          {step === 2 && hasNotificationStep(role) && (
            <div className="space-y-5">
              <div className="text-center">
                <DialogTitle className="font-heading text-[20px] text-forest">
                  Set up notifications
                </DialogTitle>
                <DialogDescription className="font-body text-[13px] text-slate mt-1">
                  How do you want to be alerted?
                </DialogDescription>
              </div>
              <div className="space-y-3">
                <NotifToggle
                  icon={<TrendingUp className="h-4 w-4 text-verdant" />}
                  label="Creative hits scale threshold"
                  checked={notifScale}
                  onChange={setNotifScale}
                />
                <NotifToggle
                  icon={<Bell className="h-4 w-4 text-destructive" />}
                  label="Creative drops below kill threshold"
                  checked={notifKill}
                  onChange={setNotifKill}
                />
                <NotifToggle
                  icon={<Calendar className="h-4 w-4 text-verdant" />}
                  label="Weekly performance summary"
                  checked={notifWeekly}
                  onChange={setNotifWeekly}
                />
              </div>
            </div>
          )}

          {/* Final Step: Done */}
          {step === totalSteps - 1 && (step !== 2 || !hasNotificationStep(role)) && (
            <div className="text-center space-y-4">
              <div className="h-14 w-14 rounded-full mx-auto flex items-center justify-center bg-verdant/10">
                <Check className="h-7 w-7 text-verdant" />
              </div>
              <DialogTitle className="font-heading text-[24px] text-forest">
                You're all set
              </DialogTitle>
              <DialogDescription className="font-body text-[13px] text-slate">
                Your dashboard is ready. You can revisit this tour anytime from the sidebar.
              </DialogDescription>
            </div>
          )}

          {/* CTA button */}
          <Button
            onClick={next}
            className="w-full mt-6 bg-verdant hover:bg-verdant/90 text-white font-body text-[14px] font-semibold gap-2 h-11 rounded-[6px]"
          >
            {step === totalSteps - 1 ? (
              <>Go to Dashboard</>
            ) : (
              <>Continue <ArrowRight className="h-4 w-4" /></>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── notification toggle row ─────────────── */

function NotifToggle({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-border-light">
      <div className="flex items-center gap-2.5">
        {icon}
        <span className="font-body text-[13px] text-charcoal">{label}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
