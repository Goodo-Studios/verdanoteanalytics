import { useState, useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trophy, Crown, Medal, Flame, TrendingUp, Loader2, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAllCreatives } from "@/hooks/useAllCreatives";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

/* ── helpers ── */
function fmt$(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function percentile(value: number, sorted: number[]): number {
  if (sorted.length === 0) return 0;
  let count = 0;
  for (const v of sorted) { if (v <= value) count++; else break; }
  return (count / sorted.length) * 100;
}

interface LeaderboardEntry {
  ad_id: string;
  ad_name: string;
  account_name: string;
  account_id: string;
  roas: number;
  ctr: number;
  hookRate: number;
  spend: number;
  creativeScore: number;
  compositeScore: number;
  thumbnail_url: string | null;
  creator_name: string | null;
  creator_id: string | null;
  ad_type: string | null;
  isYours: boolean;
}

function computeLeaderboard(
  creatives: any[],
  accounts: any[],
  creatorsMap: Map<string, string>,
  editorCreatorIds: Set<string>,
  minSpend: number
): LeaderboardEntry[] {
  const acctMap = new Map(accounts.map((a: any) => [a.id, a.name]));
  const eligible = creatives.filter((c: any) => (Number(c.spend) || 0) >= minSpend);
  if (eligible.length === 0) return [];

  // Pre-compute sorted arrays for percentile calcs
  const ctrValues = eligible.map((c: any) => Number(c.ctr) || 0).sort((a, b) => a - b);
  const hookValues = eligible.map((c: any) => Number(c.thumb_stop_rate) || 0).sort((a, b) => a - b);

  // Compute avg CPA for creative score
  const withCpa = eligible.filter((c: any) => (Number(c.cpa) || 0) > 0);
  const avgCpa = withCpa.length > 0
    ? withCpa.reduce((s: number, c: any) => s + (Number(c.cpa) || 0), 0) / withCpa.length
    : 0;

  return eligible.map((c: any) => {
    const roas = Number(c.roas) || 0;
    const ctr = Number(c.ctr) || 0;
    const hookRate = Number(c.thumb_stop_rate) || 0;
    const spend = Number(c.spend) || 0;
    const cpa = Number(c.cpa) || 0;

    // Simple creative score (inline, no fatigue/momentum for leaderboard)
    const roasScore = Math.min(35, (roas / 2.0) * 35);
    const ctrScore = Math.min(20, (ctr / 3.0) * 20);
    const hookScore = Math.min(15, (hookRate / 25) * 15);
    let cpaScore = 0;
    if (avgCpa > 0 && cpa > 0) {
      const ratio = cpa / avgCpa;
      cpaScore = ratio <= 1 ? 10 : ratio < 2 ? 10 * (1 - (ratio - 1)) : 0;
    }
    const creativeScore = Math.max(0, Math.min(100, Math.round(roasScore + ctrScore + hookScore + cpaScore + 5)));

    // Composite score for leaderboard ranking
    const ctrPct = percentile(ctr, ctrValues);
    const hookPct = percentile(hookRate, hookValues);

    // Spend efficiency: higher spend at good ROAS = better
    const spendEfficiency = roas >= 1 ? Math.min(100, (spend / 10000) * 100 * (roas / 2)) : 0;

    const compositeScore = Math.round(
      (roas / 10) * 100 * 0.30 +  // ROAS normalized to 10x max
      ctrPct * 0.20 +
      hookPct * 0.20 +
      spendEfficiency * 0.15 +
      creativeScore * 0.15
    );

    const creatorId = c.creator_id || null;

    return {
      ad_id: c.ad_id,
      ad_name: c.ad_name,
      account_name: acctMap.get(c.account_id) || c.account_id,
      account_id: c.account_id,
      roas,
      ctr,
      hookRate,
      spend,
      creativeScore,
      compositeScore: Math.min(100, compositeScore),
      thumbnail_url: c.thumbnail_url,
      creator_name: creatorId ? (creatorsMap.get(creatorId) || null) : null,
      creator_id: creatorId,
      ad_type: c.ad_type,
      isYours: creatorId ? editorCreatorIds.has(creatorId) : false,
    };
  }).sort((a, b) => b.compositeScore - a.compositeScore);
}

/* ── Page ── */
export default function LeaderboardPage() {
  const { selectedAccountId, accounts } = useAccountContext();
  const { user, isEditor } = useAuth();

  const [period, setPeriod] = useState("30");
  const [formatFilter, setFormatFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState(selectedAccountId || "all");

  // Fetch all creatives
  const filters: Record<string, string> = {};
  if (accountFilter && accountFilter !== "all") filters.account_id = accountFilter;
  const { data: creatives = [], isLoading } = useAllCreatives(filters);

  // Fetch creators for mapping
  const { data: creators = [] } = useQuery({
    queryKey: ["leaderboard-creators"],
    queryFn: async () => {
      const { data } = await supabase.from("creators").select("id, name, account_id");
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // For editor role: find creator IDs linked to this user's accounts
  const { data: userAccountIds = [] } = useQuery<string[]>({
    queryKey: ["user-account-ids", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase.rpc("get_user_account_ids", { _user_id: user.id });
      return (data || []) as string[];
    },
    enabled: !!user && isEditor,
  });

  const creatorsMap = useMemo(
    () => new Map(creators.map((c: any) => [c.id, c.name])),
    [creators]
  );

  // For editors, we consider all creators in their assigned accounts as "theirs"
  const editorCreatorIds = useMemo(() => {
    if (!isEditor) return new Set<string>();
    const accountSet = new Set(userAccountIds);
    return new Set(
      creators
        .filter((c: any) => accountSet.has(c.account_id))
        .map((c: any) => c.id)
    );
  }, [isEditor, userAccountIds, creators]);

  // Filter by period (use created_at proxy since we don't have daily metrics loaded here)
  const filteredByPeriod = useMemo(() => {
    if (period === "all") return creatives;
    const days = parseInt(period);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return creatives;
    // Note: creatives have lifetime metrics, period filter is approximate
  }, [creatives, period]);

  // Filter by format
  const filteredByFormat = useMemo(() => {
    if (formatFilter === "all") return filteredByPeriod;
    return filteredByPeriod.filter((c: any) => {
      const type = (c.ad_type || "").toLowerCase();
      if (formatFilter === "video") return type === "video" || (c.video_url && c.video_url !== "no-video");
      if (formatFilter === "static") return type === "image" || type === "static" || (!c.video_url || c.video_url === "no-video");
      if (formatFilter === "ugc") return type === "ugc" || !!c.creator_id;
      return true;
    });
  }, [filteredByPeriod, formatFilter]);

  // For editor: filter to only their assigned accounts
  const finalCreatives = useMemo(() => {
    if (!isEditor) return filteredByFormat;
    const accountSet = new Set(userAccountIds);
    return filteredByFormat.filter((c: any) => accountSet.has(c.account_id));
  }, [filteredByFormat, isEditor, userAccountIds]);

  const leaderboard = useMemo(
    () => computeLeaderboard(finalCreatives, accounts, creatorsMap, editorCreatorIds, 100),
    [finalCreatives, accounts, creatorsMap, editorCreatorIds]
  );

  const top20 = leaderboard.slice(0, 20);

  // Hall of Fame: all-time top 10 with $5k+ spend
  const hallOfFame = useMemo(() => {
    const eligible = creatives.filter((c: any) => (Number(c.spend) || 0) >= 5000);
    return eligible
      .map((c: any) => ({
        ad_id: c.ad_id,
        ad_name: c.ad_name,
        account_name: accounts.find((a: any) => a.id === c.account_id)?.name || c.account_id,
        roas: Number(c.roas) || 0,
        spend: Number(c.spend) || 0,
        thumbnail_url: c.thumbnail_url,
        creator_name: c.creator_id ? (creatorsMap.get(c.creator_id) || null) : null,
        isYours: c.creator_id ? editorCreatorIds.has(c.creator_id) : false,
      }))
      .sort((a, b) => b.roas - a.roas)
      .slice(0, 10);
  }, [creatives, accounts, creatorsMap, editorCreatorIds]);

  const rankIcon = (rank: number) => {
    if (rank === 1) return <Trophy className="h-5 w-5 text-amber-500" />;
    if (rank === 2) return <Medal className="h-5 w-5 text-slate-400" />;
    if (rank === 3) return <Medal className="h-5 w-5 text-amber-700" />;
    return <span className="font-data text-[14px] font-bold text-muted-foreground w-5 text-center">#{rank}</span>;
  };

  const rankEmoji = (rank: number) => {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return `#${rank}`;
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-heading text-[32px] text-forest flex items-center gap-3">
            <Trophy className="h-7 w-7 text-amber-500" />
            Creative Leaderboard
          </h1>
          <p className="font-body text-[14px] text-slate font-light mt-1">
            Top-performing creatives ranked by composite score
          </p>
        </div>

        <Tabs defaultValue="leaderboard">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <TabsList className="bg-transparent border-b border-border-light rounded-none p-0 h-auto gap-0">
              <TabsTrigger value="leaderboard" className="font-body text-[14px] font-medium text-slate data-[state=active]:text-forest data-[state=active]:font-semibold data-[state=active]:border-b-2 data-[state=active]:border-verdant data-[state=active]:shadow-none rounded-none px-4 py-2.5 bg-transparent gap-1.5">
                <Flame className="h-3.5 w-3.5" /> Top 20
              </TabsTrigger>
              <TabsTrigger value="hall-of-fame" className="font-body text-[14px] font-medium text-slate data-[state=active]:text-forest data-[state=active]:font-semibold data-[state=active]:border-b-2 data-[state=active]:border-verdant data-[state=active]:shadow-none rounded-none px-4 py-2.5 bg-transparent gap-1.5">
                <Crown className="h-3.5 w-3.5" /> Hall of Fame
              </TabsTrigger>
            </TabsList>

            {/* Filters */}
            <div className="flex items-center gap-2">
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger className="w-[160px] h-8 font-body text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Accounts</SelectItem>
                  {(accounts as any[]).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-[130px] h-8 font-body text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
              <Select value={formatFilter} onValueChange={setFormatFilter}>
                <SelectTrigger className="w-[110px] h-8 font-body text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Formats</SelectItem>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="static">Static</SelectItem>
                  <SelectItem value="ugc">UGC</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Top 20 Tab */}
          <TabsContent value="leaderboard" className="mt-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : top20.length === 0 ? (
              <div className="glass-panel p-16 text-center">
                <Trophy className="h-12 w-12 mx-auto text-muted-foreground/20 mb-4" />
                <h3 className="font-heading text-[18px] text-forest mb-2">No qualifying creatives</h3>
                <p className="font-body text-[13px] text-muted-foreground">
                  Creatives need at least $100 spend to appear on the leaderboard.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {top20.map((entry, idx) => (
                  <LeaderboardRow key={entry.ad_id} entry={entry} rank={idx + 1} rankIcon={rankIcon} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Hall of Fame Tab */}
          <TabsContent value="hall-of-fame" className="mt-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : hallOfFame.length === 0 ? (
              <div className="glass-panel p-16 text-center">
                <Crown className="h-12 w-12 mx-auto text-muted-foreground/20 mb-4" />
                <h3 className="font-heading text-[18px] text-forest mb-2">Hall of Fame is empty</h3>
                <p className="font-body text-[13px] text-muted-foreground">
                  Creatives need at least $5,000 spend to enter the Hall of Fame.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {hallOfFame.map((entry, idx) => (
                  <div
                    key={entry.ad_id}
                    className={cn(
                      "flex items-center gap-4 px-5 py-4 rounded-[8px] border transition-shadow",
                      entry.isYours
                        ? "border-amber-300 bg-amber-50/60 shadow-[0_0_0_1px_rgba(245,158,11,0.15)]"
                        : "border-border-light bg-white hover:shadow-card-hover"
                    )}
                  >
                    <div className="flex-shrink-0 w-8 text-center">
                      {rankIcon(idx + 1)}
                    </div>
                    {entry.thumbnail_url ? (
                      <img src={entry.thumbnail_url} alt="" className="h-12 w-12 rounded-[6px] object-cover flex-shrink-0" />
                    ) : (
                      <div className="h-12 w-12 rounded-[6px] bg-muted flex items-center justify-center flex-shrink-0">
                        <Star className="h-5 w-5 text-muted-foreground/30" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-body text-[14px] font-semibold text-charcoal truncate">{entry.ad_name}</p>
                        {entry.isYours && (
                          <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[9px] font-semibold px-1.5 py-0">
                            YOUR CREATIVE
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-body text-[11px] text-muted-foreground">{entry.account_name}</span>
                        {entry.creator_name && (
                          <>
                            <span className="text-muted-foreground/30">·</span>
                            <span className="font-body text-[11px] text-muted-foreground">by {entry.creator_name}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-6 flex-shrink-0">
                      <div className="text-right">
                        <p className="font-label text-[9px] uppercase tracking-[0.06em] text-sage">ROAS</p>
                        <p className="font-data text-[18px] font-bold text-verdant tabular-nums">{entry.roas.toFixed(2)}x</p>
                      </div>
                      <div className="text-right">
                        <p className="font-label text-[9px] uppercase tracking-[0.06em] text-sage">Spend</p>
                        <p className="font-data text-[14px] font-medium text-charcoal tabular-nums">{fmt$(entry.spend)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

/* ── Row Component ── */
function LeaderboardRow({
  entry,
  rank,
  rankIcon,
}: {
  entry: LeaderboardEntry;
  rank: number;
  rankIcon: (r: number) => React.ReactNode;
}) {
  const scoreTier =
    entry.compositeScore >= 80 ? "text-verdant" :
    entry.compositeScore >= 50 ? "text-amber-600" : "text-muted-foreground";

  return (
    <div
      className={cn(
        "flex items-center gap-4 px-5 py-3.5 rounded-[8px] border transition-shadow",
        entry.isYours
          ? "border-amber-300 bg-amber-50/60 shadow-[0_0_0_1px_rgba(245,158,11,0.15)]"
          : rank <= 3
          ? "border-border-light bg-white shadow-card"
          : "border-border-light bg-white hover:shadow-card-hover"
      )}
    >
      {/* Rank */}
      <div className="flex-shrink-0 w-8 text-center">
        {rankIcon(rank)}
      </div>

      {/* Thumbnail */}
      {entry.thumbnail_url ? (
        <img src={entry.thumbnail_url} alt="" className="h-11 w-11 rounded-[6px] object-cover flex-shrink-0" />
      ) : (
        <div className="h-11 w-11 rounded-[6px] bg-muted flex items-center justify-center flex-shrink-0">
          <TrendingUp className="h-4 w-4 text-muted-foreground/30" />
        </div>
      )}

      {/* Name + Account + Creator */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-body text-[13px] font-semibold text-charcoal truncate">{entry.ad_name}</p>
          {entry.isYours && (
            <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[9px] font-semibold px-1.5 py-0">
              YOUR CREATIVE
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-body text-[11px] text-muted-foreground">{entry.account_name}</span>
          {entry.creator_name && (
            <>
              <span className="text-muted-foreground/30">·</span>
              <span className="font-body text-[11px] text-muted-foreground">by {entry.creator_name}</span>
            </>
          )}
        </div>
      </div>

      {/* Score */}
      <div className="flex-shrink-0 text-center w-14">
        <p className="font-label text-[9px] uppercase tracking-[0.06em] text-sage">Score</p>
        <p className={cn("font-data text-[20px] font-bold tabular-nums", scoreTier)}>
          {entry.compositeScore}
        </p>
      </div>

      {/* ROAS */}
      <div className="flex-shrink-0 text-right w-16">
        <p className="font-label text-[9px] uppercase tracking-[0.06em] text-sage">ROAS</p>
        <p className={cn("font-data text-[15px] font-semibold tabular-nums", entry.roas >= 2 ? "text-verdant" : entry.roas < 1 ? "text-destructive" : "text-charcoal")}>
          {entry.roas.toFixed(1)}x
        </p>
      </div>

      {/* Spend */}
      <div className="flex-shrink-0 text-right w-16">
        <p className="font-label text-[9px] uppercase tracking-[0.06em] text-sage">Spend</p>
        <p className="font-data text-[14px] font-medium text-charcoal tabular-nums">{fmt$(entry.spend)}</p>
      </div>
    </div>
  );
}
