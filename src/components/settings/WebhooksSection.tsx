import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Trash2, Send, Loader2, Webhook, CheckCircle2, XCircle } from "lucide-react";

const WEBHOOK_EVENTS = [
  { id: "creative.scaled", label: "Creative Scaled", desc: "Creative crossed scale threshold" },
  { id: "creative.killed", label: "Creative Killed", desc: "Creative crossed kill threshold" },
  { id: "creative.new", label: "New Creative", desc: "New creative detected in sync" },
  { id: "sync.completed", label: "Sync Completed", desc: "Account sync finished" },
  { id: "sync.failed", label: "Sync Failed", desc: "Account sync failed" },
  { id: "test.winner", label: "Test Winner", desc: "Split test winner declared" },
  { id: "report.created", label: "Report Created", desc: "New report created" },
  { id: "brief.sent", label: "Brief Sent", desc: "Brief status changed to sent" },
] as const;

interface WebhookRow {
  id: string;
  name: string;
  url: string;
  events: string[];
  account_ids: string[];
  is_active: boolean;
  secret: string | null;
  last_triggered_at: string | null;
  last_status_code: number | null;
  created_at: string;
}

export function WebhooksSection() {
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formEvents, setFormEvents] = useState<string[]>([]);
  const [formSecret, setFormSecret] = useState("");

  const fetchWebhooks = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("webhooks" as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) setWebhooks((data as any) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchWebhooks(); }, [fetchWebhooks]);

  const handleCreate = async () => {
    if (!formName.trim() || !formUrl.trim() || formEvents.length === 0) {
      toast.error("Name, URL, and at least one event are required");
      return;
    }
    try {
      new URL(formUrl);
    } catch {
      toast.error("Invalid URL format");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("webhooks" as any).insert({
      name: formName.trim(),
      url: formUrl.trim(),
      events: formEvents,
      secret: formSecret.trim() || null,
      account_ids: [],
    } as any);
    setSaving(false);
    if (error) {
      toast.error("Failed to create webhook", { description: error.message });
    } else {
      toast.success("Webhook created");
      setShowForm(false);
      setFormName(""); setFormUrl(""); setFormEvents([]); setFormSecret("");
      fetchWebhooks();
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    await supabase.from("webhooks" as any).update({ is_active: active } as any).eq("id", id);
    setWebhooks((prev) => prev.map((w) => (w.id === id ? { ...w, is_active: active } : w)));
  };

  const handleDelete = async (id: string) => {
    await supabase.from("webhooks" as any).delete().eq("id", id);
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
    toast.success("Webhook deleted");
  };

  const handleTest = async (webhook: WebhookRow) => {
    setTesting(webhook.id);
    try {
      const { error } = await supabase.functions.invoke("webhooks-dispatch", {
        body: {
          event: "test.ping",
          account_id: null,
          account_name: "Test Account",
          data: { message: "This is a test payload from Verdanote" },
          test_webhook_id: webhook.id,
        },
      });
      if (error) throw error;
      toast.success("Test payload sent");
      fetchWebhooks();
    } catch (e: any) {
      toast.error("Test failed", { description: e.message });
    } finally {
      setTesting(null);
    }
  };

  const toggleEvent = (eventId: string) => {
    setFormEvents((prev) =>
      prev.includes(eventId) ? prev.filter((e) => e !== eventId) : [...prev, eventId]
    );
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="section-title">Outbound Webhooks</h2>
          <p className="page-subtitle mt-1">Push events to external tools like Zapier, Make, Slack, or Notion.</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />New Webhook
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="glass-panel p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="metric-label">Name</Label>
              <Input
                placeholder="My Zapier Webhook"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="metric-label">Endpoint URL</Label>
              <Input
                placeholder="https://hooks.zapier.com/..."
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="metric-label">Secret (optional, for HMAC-SHA256 signature)</Label>
            <Input
              placeholder="whsec_..."
              value={formSecret}
              onChange={(e) => setFormSecret(e.target.value)}
              type="password"
            />
          </div>

          <div className="space-y-2">
            <Label className="metric-label">Events</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {WEBHOOK_EVENTS.map((ev) => (
                <label
                  key={ev.id}
                  className="flex items-start gap-2 p-2 rounded-md border border-border cursor-pointer hover:bg-accent/50 transition-colors"
                >
                  <Checkbox
                    checked={formEvents.includes(ev.id)}
                    onCheckedChange={() => toggleEvent(ev.id)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-medium">{ev.label}</div>
                    <div className="text-[10px] text-muted-foreground">{ev.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Create Webhook
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Webhook list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : webhooks.length === 0 ? (
        <div className="glass-panel p-8 text-center">
          <Webhook className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No webhooks configured yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Create one to start pushing events to external tools.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((wh) => (
            <div key={wh.id} className="glass-panel p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Switch
                    checked={wh.is_active}
                    onCheckedChange={(checked) => handleToggle(wh.id, checked)}
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{wh.name}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{wh.url}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {wh.last_status_code != null && (
                    <Badge variant="outline" className="text-xs gap-1">
                      {wh.last_status_code >= 200 && wh.last_status_code < 300 ? (
                        <CheckCircle2 className="h-3 w-3 text-success" />
                      ) : (
                        <XCircle className="h-3 w-3 text-destructive" />
                      )}
                      {wh.last_status_code}
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleTest(wh)}
                    disabled={testing === wh.id}
                  >
                    {testing === wh.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDelete(wh.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 mt-3">
                {wh.events.map((ev) => (
                  <Badge key={ev} variant="secondary" className="text-[10px]">{ev}</Badge>
                ))}
              </div>

              {wh.last_triggered_at && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  Last triggered: {new Date(wh.last_triggered_at).toLocaleString()}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Payload docs */}
      <div className="glass-panel p-4 space-y-2">
        <h3 className="card-title">Payload Format</h3>
        <pre className="text-xs font-mono text-muted-foreground bg-muted/50 p-3 rounded-md overflow-x-auto">
{`{
  "event": "creative.scaled",
  "timestamp": "2026-02-28T10:00:00Z",
  "account_id": "act_44401754",
  "account_name": "Natural Dog Company",
  "data": { ...event-specific data... }
}`}
        </pre>
        <p className="text-xs text-muted-foreground">
          When a secret is configured, payloads include an <code className="font-mono">X-Verdanote-Signature</code> header
          with an HMAC-SHA256 hex digest of the JSON body.
        </p>
      </div>
    </div>
  );
}
