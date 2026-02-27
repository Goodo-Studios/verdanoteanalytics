import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Lightbulb, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const CACHE_KEY_PREFIX = "verdanote_client_insights_";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface CachedInsights {
  insights: string[];
  timestamp: number;
}

interface ClientInsightsFeedProps {
  accountId: string;
}

export function ClientInsightsFeed({ accountId }: ClientInsightsFeedProps) {
  const [insights, setInsights] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const cacheKey = `${CACHE_KEY_PREFIX}${accountId}`;

  const fetchInsights = useCallback(async (force = false) => {
    if (!force) {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed: CachedInsights = JSON.parse(cached);
          if (Date.now() - parsed.timestamp < CACHE_TTL && parsed.insights.length > 0) {
            setInsights(parsed.insights);
            setLoading(false);
            return;
          }
        }
      } catch {}
    }

    setLoading(true);
    setError(false);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("client-insights", {
        body: { accountId },
      });

      if (fnError) throw fnError;
      const result = data?.insights || [];
      setInsights(result);
      if (result.length > 0) {
        localStorage.setItem(cacheKey, JSON.stringify({ insights: result, timestamp: Date.now() }));
      }
    } catch (err) {
      console.error("Failed to fetch insights:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [accountId, cacheKey]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  if (loading) {
    return (
      <div className="glass-panel p-6">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="h-4 w-4 text-warning" />
          <h3 className="font-heading text-[18px] text-foreground">Insights</h3>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="font-body text-[13px]">Analyzing your creative performance…</span>
        </div>
      </div>
    );
  }

  if (error || insights.length === 0) {
    return null;
  }

  return (
    <div className="glass-panel p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-warning" />
          <h3 className="font-heading text-[18px] text-foreground">Insights</h3>
        </div>
        <button
          onClick={() => fetchInsights(true)}
          className="p-1.5 rounded-md hover:bg-muted transition-colors"
          title="Refresh insights"
        >
          <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
      <div className="space-y-3">
        {insights.map((insight, i) => (
          <div key={i} className="flex items-start gap-3 py-2">
            <span className={cn(
              "shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center font-data text-[11px] font-bold",
              i === 0 ? "bg-primary/10 text-primary" :
              i === 1 ? "bg-warning/10 text-warning" :
              "bg-info/10 text-info"
            )}>
              {i + 1}
            </span>
            <p className="font-body text-[14px] text-foreground leading-relaxed">
              {insight}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
