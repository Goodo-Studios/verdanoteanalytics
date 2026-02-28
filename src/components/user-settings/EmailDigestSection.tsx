import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAccounts } from "@/hooks/useAccountsApi";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Mail, Loader2, Eye, Send } from "lucide-react";
import { toast } from "sonner";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;

export function EmailDigestSection() {
  const { user } = useAuth();
  const { data: accounts = [] } = useAccounts();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [digestDay, setDigestDay] = useState("monday");
  const [digestAccounts, setDigestAccounts] = useState<string[]>([]);
  const [lastSent, setLastSent] = useState<string | null>(null);

  const [previewing, setPreviewing] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Load preferences
  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("user_preferences")
        .select("digest_enabled, digest_day, digest_accounts, last_digest_sent_at")
        .eq("user_id", user.id)
        .single();
      if (data) {
        setDigestEnabled((data as any).digest_enabled ?? true);
        setDigestDay((data as any).digest_day || "monday");
        setDigestAccounts((data as any).digest_accounts || []);
        setLastSent((data as any).last_digest_sent_at || null);
      }
      setLoading(false);
    })();
  }, [user]);

  // Save preferences
  const save = useCallback(
    async (updates: Record<string, any>) => {
      if (!user) return;
      setSaving(true);
      try {
        const { error } = await supabase
          .from("user_preferences")
          .update(updates as any)
          .eq("user_id", user.id);
        if (error) throw error;
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setSaving(false);
      }
    },
    [user]
  );

  const handleToggle = (v: boolean) => {
    setDigestEnabled(v);
    save({ digest_enabled: v });
  };

  const handleDayChange = (v: string) => {
    setDigestDay(v);
    save({ digest_day: v });
  };

  const handleAccountToggle = (accountId: string, checked: boolean) => {
    const next = checked
      ? [...digestAccounts, accountId]
      : digestAccounts.filter((id) => id !== accountId);
    setDigestAccounts(next);
    save({ digest_accounts: next });
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setPreviewHtml(null);
    try {
      const { data, error } = await supabase.functions.invoke("send-digest", {
        body: { preview: true },
      });
      if (error) throw error;
      setPreviewHtml(data.html);
    } catch (e: any) {
      toast.error(e.message || "Failed to generate preview");
    } finally {
      setPreviewing(false);
    }
  };

  const handleSendTest = async () => {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-digest", {
        body: {},
      });
      if (error) throw error;
      if (data.note) {
        toast.info(data.note);
        // Show preview if no email was sent
        setPreviewHtml(data.html);
      } else {
        toast.success("Test digest sent to your email!");
      }
      setLastSent(new Date().toISOString());
    } catch (e: any) {
      toast.error(e.message || "Failed to send digest");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="font-body text-[13px] text-muted-foreground">Loading digest settings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-heading text-[18px] text-forest flex items-center gap-2">
          <Mail className="h-4 w-4 text-sage" />
          Email Digest
        </h3>
        <p className="font-body text-[13px] text-muted-foreground mt-1">
          Receive a weekly performance summary in your inbox.
        </p>
      </div>

      {/* Toggle */}
      <div className="flex items-center justify-between py-2">
        <Label className="font-body text-[13px] font-medium text-charcoal">
          Receive weekly performance digest
        </Label>
        <Switch checked={digestEnabled} onCheckedChange={handleToggle} />
      </div>

      {digestEnabled && (
        <>
          {/* Day selector */}
          <div className="space-y-1.5">
            <Label className="font-body text-[13px] font-medium text-charcoal">Delivery day</Label>
            <Select value={digestDay} onValueChange={handleDayChange}>
              <SelectTrigger className="w-[180px] bg-background font-body text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS.map((d) => (
                  <SelectItem key={d} value={d} className="font-body text-[13px] capitalize">
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Account selector */}
          <div className="space-y-2">
            <Label className="font-body text-[13px] font-medium text-charcoal">
              Accounts to include
            </Label>
            <p className="font-body text-[11px] text-muted-foreground">
              {digestAccounts.length === 0
                ? "All accounts will be included by default."
                : `${digestAccounts.length} account${digestAccounts.length !== 1 ? "s" : ""} selected.`}
            </p>
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {(accounts as any[]).map((acct: any) => (
                <label
                  key={acct.id}
                  className="flex items-center gap-2.5 py-1.5 px-2 rounded-md hover:bg-accent/30 cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={digestAccounts.includes(acct.id)}
                    onCheckedChange={(checked) => handleAccountToggle(acct.id, !!checked)}
                  />
                  <span className="font-body text-[13px] text-charcoal">{acct.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="outline"
              size="sm"
              className="font-body text-[12px] gap-1.5"
              onClick={handlePreview}
              disabled={previewing}
            >
              {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
              Preview Digest
            </Button>
            <Button
              size="sm"
              className="font-body text-[12px] gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleSendTest}
              disabled={sending}
            >
              {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Send Test Digest
            </Button>
          </div>

          {lastSent && (
            <p className="font-body text-[11px] text-muted-foreground">
              Last sent: {new Date(lastSent).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </>
      )}

      {/* Preview Modal */}
      <Dialog open={!!previewHtml} onOpenChange={() => setPreviewHtml(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-white rounded-[8px] shadow-modal p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle className="font-heading text-[18px] text-forest flex items-center gap-2">
              <Mail className="h-4 w-4 text-sage" />
              Digest Preview
            </DialogTitle>
          </DialogHeader>
          {previewHtml && (
            <div className="border-t border-border-light">
              <iframe
                srcDoc={previewHtml}
                className="w-full border-0"
                style={{ minHeight: "600px" }}
                title="Digest Preview"
                sandbox="allow-same-origin"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
