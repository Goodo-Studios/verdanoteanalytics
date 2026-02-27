import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2, ExternalLink, TrendingUp, DollarSign, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface PortfolioData {
  name: string;
  logo_url: string | null;
  headline: string;
  results: string[];
  cta_url: string;
  metrics: {
    totalSpend: number;
    blendedRoas: number;
    totalPurchases: number;
  };
  topCreatives: { thumbnail_url: string; roas: number; spend: number }[];
}

export default function PortfolioPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/portfolio/${slug}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setData(d); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <h1 className="font-heading text-[24px] text-foreground">Portfolio not found</h1>
        <p className="font-body text-[14px] text-muted-foreground">This portfolio doesn't exist or hasn't been enabled yet.</p>
        <Link to="/login" className="font-body text-[13px] text-primary hover:underline">Sign in →</Link>
      </div>
    );
  }

  const fmt = (n: number) => n >= 1000000
    ? `$${(n / 1000000).toFixed(1)}M`
    : n >= 1000
      ? `$${(n / 1000).toFixed(0)}K`
      : `$${n.toFixed(0)}`;

  const fmtCount = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {data.logo_url ? (
              <img src={data.logo_url} alt={data.name} className="h-10 w-10 rounded-lg object-cover" />
            ) : (
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <span className="font-heading text-[18px] text-primary">{data.name.charAt(0)}</span>
              </div>
            )}
            <div>
              <h1 className="font-heading text-[22px] text-foreground">{data.name}</h1>
              <p className="font-body text-[12px] text-muted-foreground">{data.headline}</p>
            </div>
          </div>
          <Button asChild size="sm" className="gap-1.5">
            <a href={data.cta_url} target="_blank" rel="noopener noreferrer">
              Work with Us <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-12">
        {/* Hero Metrics */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricHero
            icon={<DollarSign className="h-5 w-5 text-primary" />}
            label="Ad Spend Managed"
            value={fmt(data.metrics.totalSpend)}
          />
          <MetricHero
            icon={<TrendingUp className="h-5 w-5 text-primary" />}
            label="Blended ROAS"
            value={`${data.metrics.blendedRoas.toFixed(2)}x`}
          />
          <MetricHero
            icon={<ShoppingBag className="h-5 w-5 text-primary" />}
            label="Purchases Driven"
            value={fmtCount(data.metrics.totalPurchases)}
          />
        </section>

        {/* Top Creatives */}
        {data.topCreatives.length > 0 && (
          <section>
            <h2 className="font-heading text-[20px] text-foreground mb-4">Top Performing Creatives</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {data.topCreatives.map((c, i) => (
                <div key={i} className="relative bg-card border border-border rounded-xl overflow-hidden group">
                  <div className="aspect-square bg-muted">
                    <img src={c.thumbnail_url} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                    <Badge className="bg-card/90 text-foreground border border-border backdrop-blur-sm font-data text-[11px]">
                      {c.roas.toFixed(2)}x ROAS
                    </Badge>
                    <Badge variant="outline" className="bg-card/90 backdrop-blur-sm font-data text-[11px]">
                      ${c.spend.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Results */}
        {data.results.length > 0 && (
          <section className="bg-card border border-border rounded-xl p-6">
            <h2 className="font-heading text-[20px] text-foreground mb-4">Results</h2>
            <ul className="space-y-3">
              {data.results.map((r, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
                  <span className="font-body text-[14px] text-foreground">{r}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* CTA */}
        <section className="text-center py-8">
          <h2 className="font-heading text-[24px] text-foreground mb-2">Ready to scale your creative?</h2>
          <p className="font-body text-[14px] text-muted-foreground mb-6 max-w-md mx-auto">
            Let's build a high-performing creative strategy for your brand.
          </p>
          <Button asChild size="lg" className="gap-2">
            <a href={data.cta_url} target="_blank" rel="noopener noreferrer">
              Work with Goodo Studios <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-4 text-center">
        <p className="font-body text-[11px] text-muted-foreground">
          Powered by <span className="font-semibold">Goodo Studios</span>
        </p>
      </footer>
    </div>
  );
}

function MetricHero({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-6 text-center">
      <div className="flex justify-center mb-3">{icon}</div>
      <p className="font-data text-[28px] font-bold text-foreground tabular-nums">{value}</p>
      <p className="font-label text-[11px] uppercase tracking-wider text-muted-foreground mt-1">{label}</p>
    </div>
  );
}
