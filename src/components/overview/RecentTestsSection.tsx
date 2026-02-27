import { useSplitTests } from "@/hooks/useSplitTestsApi";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FlaskConical, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  accountId?: string;
}

export function RecentTestsSection({ accountId }: Props) {
  const navigate = useNavigate();
  const { data: tests = [] } = useSplitTests(accountId);
  const recent = tests.slice(0, 4);

  if (recent.length === 0) {
    return (
      <div className="bg-white border border-border-light rounded-[8px] p-5 text-center">
        <FlaskConical className="h-8 w-8 text-sage mx-auto mb-2" />
        <p className="font-body text-[13px] text-sage">No split tests yet.</p>
        <button onClick={() => navigate("/tests")} className="font-body text-[13px] font-medium text-verdant hover:underline mt-2 inline-flex items-center gap-1">
          Create a test <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-border-light rounded-[8px] p-5">
      <h2 className="font-heading text-[18px] text-forest mb-4">Recent Tests</h2>
      <div className="space-y-3">
        {recent.map((t) => (
          <div key={t.id} className="flex items-center gap-3">
            <div className={cn(
              "h-2 w-2 rounded-full shrink-0",
              t.status === "running" ? "bg-verdant" : t.status === "complete" ? "bg-forest" : "bg-sage",
            )} />
            <div className="min-w-0 flex-1">
              <p className="font-body text-[13px] font-medium text-charcoal truncate">{t.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-label text-[9px] uppercase tracking-wide text-sage">{t.status}</span>
                {t.variable_tested && <span className="font-label text-[9px] uppercase tracking-wide text-slate">· {t.variable_tested}</span>}
                {t.winner_ad_id && <Trophy className="h-3 w-3 text-gold" />}
              </div>
            </div>
          </div>
        ))}
        <button onClick={() => navigate("/tests")} className="font-body text-[13px] font-medium text-verdant hover:underline flex items-center gap-1 mt-1">
          View all <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
