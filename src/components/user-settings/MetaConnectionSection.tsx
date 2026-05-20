import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

interface MetaConnectionSectionProps {
  metaStatus: "unknown" | "connected" | "disconnected" | "testing";
  metaUser: string | null;
  onTestConnection: (token?: string) => void;
  onSaveToken: (token: string) => void;
  isSavingToken?: boolean;
}

export function MetaConnectionSection({ metaStatus, metaUser, onTestConnection, onSaveToken, isSavingToken }: MetaConnectionSectionProps) {
  const [tokenInput, setTokenInput] = useState("");

  return (
    <section className="glass-panel p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-[20px] text-forest">Meta Connection</h2>
          <p className="font-body text-[13px] text-slate mt-0.5">Enter your Meta access token to connect your ad accounts.</p>
        </div>
        {metaStatus === "testing" ? (
          <span className="font-label text-[10px] font-semibold tracking-wide bg-muted text-slate rounded-[4px] px-2.5 py-1 inline-flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Testing
          </span>
        ) : metaStatus === "connected" ? (
          <span className="font-label text-[10px] font-semibold tracking-wide bg-sage-light text-verdant rounded-[4px] px-2.5 py-1 inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-3 w-3" /> {metaUser || "Connected"}
          </span>
        ) : (
          <span className="font-label text-[10px] font-semibold tracking-wide bg-red-50 text-red-700 rounded-[4px] px-2.5 py-1 inline-flex items-center gap-1.5">
            <XCircle className="h-3 w-3" /> Not Connected
          </span>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="meta-token" className="font-body text-[13px] text-forest">Access Token</Label>
        <Input
          id="meta-token"
          type="password"
          placeholder="Paste your Meta access token here"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          className="font-body text-[13px]"
        />
      </div>
      <div className="flex gap-2">
        <Button
          onClick={() => onSaveToken(tokenInput)}
          disabled={!tokenInput || isSavingToken}
          size="sm"
          className="bg-verdant text-white hover:bg-verdant/90 font-body text-[13px] font-semibold"
        >
          {isSavingToken ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
          Save Token
        </Button>
        <Button
          onClick={() => onTestConnection(tokenInput || undefined)}
          disabled={metaStatus === "testing"}
          size="sm"
          variant="outline"
          className="font-body text-[13px] font-semibold"
        >
          {metaStatus === "testing" ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
          Test Connection
        </Button>
      </div>
    </section>
  );
}
