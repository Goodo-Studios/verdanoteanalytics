import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ExternalLink, Copy, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  account: any;
}

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function PortfolioSettingsSection({ account }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [slug, setSlug] = useState("");
  const [headline, setHeadline] = useState("");
  const [results, setResults] = useState(["", "", ""]);
  const [ctaUrl, setCtaUrl] = useState("https://goodostudios.com");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!account) return;
    setEnabled(account.portfolio_enabled || false);
    setSlug(account.portfolio_slug || slugify(account.name));
    setHeadline(account.portfolio_headline || "");
    const r = account.portfolio_results || [];
    setResults([r[0] || "", r[1] || "", r[2] || ""]);
    setCtaUrl(account.portfolio_cta_url || "https://goodostudios.com");
  }, [account]);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await (supabase as any)
      .from("ad_accounts")
      .update({
        portfolio_enabled: enabled,
        portfolio_slug: slug.trim() || null,
        portfolio_headline: headline.trim() || null,
        portfolio_results: results.filter(r => r.trim()),
        portfolio_cta_url: ctaUrl.trim() || "https://goodostudios.com",
      })
      .eq("id", account.id);

    setSaving(false);
    if (error) toast.error("Failed to save portfolio settings");
    else toast.success("Portfolio settings saved");
  };

  const portfolioUrl = `${window.location.origin}/portfolio/${slug}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(portfolioUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="glass-panel p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-[20px] text-foreground">Portfolio Page</h2>
          <p className="font-body text-[12px] text-muted-foreground">Share a public performance page with prospects.</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      {enabled && (
        <div className="space-y-3 pt-2">
          <div className="space-y-1.5">
            <Label className="font-label text-[11px] uppercase tracking-wider">Portfolio URL Slug</Label>
            <div className="flex items-center gap-2">
              <Input
                value={slug}
                onChange={(e) => setSlug(slugify(e.target.value))}
                className="h-8 text-[13px] font-body font-mono"
                placeholder="my-brand"
              />
              <Button size="sm" variant="outline" onClick={handleCopy} className="gap-1.5 shrink-0">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy URL"}
              </Button>
              <Button size="sm" variant="outline" asChild className="shrink-0">
                <a href={portfolioUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
            <p className="font-body text-[11px] text-muted-foreground">{portfolioUrl}</p>
          </div>

          <div className="space-y-1.5">
            <Label className="font-label text-[11px] uppercase tracking-wider">Headline (optional)</Label>
            <Input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              className="h-8 text-[13px] font-body"
              placeholder="Creative Performance"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="font-label text-[11px] uppercase tracking-wider">Results Bullets</Label>
            {results.map((r, i) => (
              <Input
                key={i}
                value={r}
                onChange={(e) => {
                  const next = [...results];
                  next[i] = e.target.value;
                  setResults(next);
                }}
                className="h-8 text-[13px] font-body"
                placeholder={`Result ${i + 1}…`}
              />
            ))}
          </div>

          <div className="space-y-1.5">
            <Label className="font-label text-[11px] uppercase tracking-wider">CTA URL</Label>
            <Input
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
              className="h-8 text-[13px] font-body"
              placeholder="https://goodostudios.com"
            />
          </div>

          <Button size="sm" onClick={handleSave} disabled={saving || !slug.trim()}>
            {saving ? "Saving…" : "Save Portfolio Settings"}
          </Button>
        </div>
      )}
    </section>
  );
}
