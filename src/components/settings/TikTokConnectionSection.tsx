import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface TikTokConnectionSectionProps {
  account: any;
  tiktokAdvertiserId: string;
  setTiktokAdvertiserId: (v: string) => void;
  tiktokAccessToken: string;
  setTiktokAccessToken: (v: string) => void;
  onSave: () => void;
  saving: boolean;
}

export function TikTokConnectionSection({
  account,
  tiktokAdvertiserId,
  setTiktokAdvertiserId,
  tiktokAccessToken,
  setTiktokAccessToken,
  onSave,
  saving,
}: TikTokConnectionSectionProps) {
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const isConnected = !!(account?.tiktok_advertiser_id && account?.tiktok_access_token);

  const handleTestConnection = async () => {
    if (!tiktokAdvertiserId || !tiktokAccessToken) {
      toast.error("Please enter both Advertiser ID and Access Token");
      return;
    }
    setTesting(true);
    setConnectionStatus("idle");
    try {
      const resp = await fetch(
        `https://business-api.tiktok.com/open_api/v1.3/advertiser/info/?advertiser_ids=["${tiktokAdvertiserId}"]`,
        {
          headers: {
            "Access-Token": tiktokAccessToken,
            "Content-Type": "application/json",
          },
        }
      );
      const json = await resp.json();
      if (json.code === 0 && json.data?.list?.length > 0) {
        const advertiser = json.data.list[0];
        setConnectionStatus("success");
        setStatusMessage(`Connected: ${advertiser.advertiser_name || tiktokAdvertiserId}`);
      } else {
        setConnectionStatus("error");
        setStatusMessage(json.message || "Connection failed — check credentials");
      }
    } catch (err: any) {
      setConnectionStatus("error");
      setStatusMessage("Network error — unable to reach TikTok API");
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="glass-panel p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-[20px] text-forest flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15.2a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V9.05a8.16 8.16 0 0 0 4.76 1.52V7.12a4.83 4.83 0 0 1-1-.43Z" />
            </svg>
            TikTok Ads Connection
          </h2>
          <p className="font-body text-[13px] text-slate mt-0.5">
            Connect TikTok Ads to pull creative performance alongside Meta.
          </p>
        </div>
        {isConnected && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-verdant/10 text-verdant font-body text-[12px] font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" />Connected
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-2">
          <Label className="font-body text-[14px] font-medium text-charcoal">Advertiser ID</Label>
          <Input
            value={tiktokAdvertiserId}
            onChange={(e) => setTiktokAdvertiserId(e.target.value)}
            placeholder="e.g. 7123456789012345678"
            className="bg-background font-data text-[15px] font-medium text-charcoal"
          />
          <p className="font-body text-[12px] text-sage">
            Found in TikTok Ads Manager → Account Info.
          </p>
        </div>
        <div className="space-y-2">
          <Label className="font-body text-[14px] font-medium text-charcoal">Access Token</Label>
          <Input
            type="password"
            value={tiktokAccessToken}
            onChange={(e) => setTiktokAccessToken(e.target.value)}
            placeholder="Enter your TikTok Marketing API token"
            className="bg-background font-data text-[15px] font-medium text-charcoal"
          />
          <p className="font-body text-[12px] text-sage">
            Generate at{" "}
            <a
              href="https://business-api.tiktok.com/portal/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-verdant hover:underline inline-flex items-center gap-0.5"
            >
              TikTok for Business <ExternalLink className="h-3 w-3" />
            </a>
            . Requires Reporting and Ad Management scopes.
          </p>
        </div>
      </div>

      {/* Connection status */}
      {connectionStatus !== "idle" && (
        <div className={`flex items-center gap-2 p-3 rounded-md ${connectionStatus === "success" ? "bg-verdant/10 text-verdant" : "bg-red-50 text-red-700"}`}>
          {connectionStatus === "success" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          <span className="font-body text-[13px] font-medium">{statusMessage}</span>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          onClick={handleTestConnection}
          disabled={testing || !tiktokAdvertiserId || !tiktokAccessToken}
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
          Test Connection
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
          Save TikTok Settings
        </Button>
      </div>
    </section>
  );
}
