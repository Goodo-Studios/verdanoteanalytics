// SlackConnect — port from Creative Vault WorkspaceSettingsPage (US-011).
// Differences from source:
//   • No workspace_id — slack_connections is user-scoped (auth.uid()).
//   • No owner gating — every authenticated user can connect their own Slack.
//   • Rendered inline as a section in a modal/page rather than a standalone page.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Slack, Trash2 } from "lucide-react";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { supabase } from "@/integrations/supabase/client";

type SlackConnection = {
  id: string;
  team_id: string;
  team_name: string;
  created_at: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EVENTS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vault-slack-events`;

export function SlackConnect({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [channelId, setChannelId] = useState("");
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);

  const { data: connection, refetch: refetchConn } = useQuery<SlackConnection | null>({
    queryKey: ["slack-connection"],
    enabled: open,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("slack_connections")
        .select("id, team_id, team_name, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as SlackConnection | null) ?? null;
    },
  });

  const callFn = async <T,>(name: string, body: Record<string, unknown>): Promise<T> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not authenticated");
    const res = await supabase.functions.invoke(name, {
      body,
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.error) throw new Error(String(res.error));
    if ((res.data as { error?: string })?.error) {
      throw new Error((res.data as { error: string }).error);
    }
    return res.data as T;
  };

  const connect = useMutation({
    mutationFn: () =>
      callFn<{ connection_id: string; team_name: string }>("vault-slack-connect", {
        bot_token: botToken,
        signing_secret: signingSecret,
      }),
    onSuccess: (data) => {
      toast.success(`Connected to ${data.team_name}`);
      setBotToken("");
      setSigningSecret("");
      refetchConn();
      qc.invalidateQueries({ queryKey: ["slack-connection"] });
    },
    onError: (err) => toast.error(String(err)),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      if (!connection) throw new Error("No connection to remove");
      const { error } = await (supabase as any)
        .from("slack_connections")
        .delete()
        .eq("id", connection.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Slack disconnected");
      setImportResult(null);
      refetchConn();
      qc.invalidateQueries({ queryKey: ["slack-connection"] });
    },
    onError: (err) => toast.error(String(err)),
  });

  const importHistory = useMutation({
    mutationFn: (oldest?: number) =>
      callFn<{ ok: boolean; imported: number; skipped: number }>("vault-slack-import", {
        channel_id: channelId,
        ...(oldest ? { oldest } : {}),
      }),
    onSuccess: (data) => {
      setImportResult({ imported: data.imported, skipped: data.skipped });
      toast.success(`Imported ${data.imported} items (${data.skipped} already saved)`);
    },
    onError: (err) => toast.error(String(err)),
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40 animate-in fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto bg-background rounded-xl shadow-2xl p-6 animate-in zoom-in-95">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold flex items-center gap-2">
              <Slack className="w-5 h-5 text-primary" />
              Slack Import
            </Dialog.Title>
            <Dialog.Close className="p-1 rounded hover:bg-muted transition-colors" aria-label="Close">
              <span aria-hidden>×</span>
            </Dialog.Close>
          </div>

          <Dialog.Description className="text-sm text-muted-foreground mb-6">
            Connect a Slack workspace so ads, videos, and links shared in your monitored channels
            are auto-imported into your vault.
          </Dialog.Description>

          {connection ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 text-xs font-medium">
                    ● Connected
                  </span>
                  <span className="text-foreground font-medium">{connection.team_name}</span>
                </div>
                <button
                  onClick={() => disconnect.mutate()}
                  disabled={disconnect.isPending}
                  className="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                  title="Disconnect Slack"
                  aria-label="Disconnect Slack"
                >
                  {disconnect.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Channel ID to import from</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={channelId}
                    onChange={(e) => setChannelId(e.target.value)}
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="C050N5Q1T0A"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setImportResult(null);
                      importHistory.mutate(Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000));
                    }}
                    disabled={!channelId.trim() || importHistory.isPending}
                    className="flex-1 rounded-lg border border-border bg-background text-foreground px-4 py-2 text-sm font-medium hover:bg-muted transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40"
                  >
                    {importHistory.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    Last 2 weeks
                  </button>
                  <button
                    onClick={() => {
                      setImportResult(null);
                      importHistory.mutate(undefined);
                    }}
                    disabled={!channelId.trim() || importHistory.isPending}
                    className="flex-1 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
                  >
                    {importHistory.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    {importHistory.isPending ? "Importing…" : "All History"}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Imports video links (TikTok, Instagram, YouTube Shorts, Twitter/X) and thread
                  replies from the channel. Duplicate URLs are skipped.
                </p>
                {importResult && (
                  <p className="text-xs font-medium text-foreground">
                    Done — {importResult.imported} new items added, {importResult.skipped} already in vault.
                  </p>
                )}
              </div>

              <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 text-xs space-y-1.5">
                <p className="font-medium">Ongoing sync</p>
                <p className="text-muted-foreground">
                  New URLs shared in channels your bot is invited to will auto-import. Make sure your
                  Slack app Event Subscriptions point to:
                </p>
                <code className="block break-all select-all text-primary mt-1">{EVENTS_URL}</code>
                <p className="text-muted-foreground">
                  Subscribe to the <strong>message.channels</strong> event and add the bot to each
                  channel you want imported.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 text-xs space-y-1.5">
                <p className="font-medium">Setup: point your Slack App Event Subscriptions to:</p>
                <code className="block break-all select-all text-primary">{EVENTS_URL}</code>
                <p className="text-muted-foreground">
                  Subscribe to the <strong>message.channels</strong> event and add the bot to your
                  channel for ongoing sync.
                </p>
              </div>

              <div className="space-y-2">
                <input
                  type="password"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Bot User OAuth Token (xoxb-…)"
                  autoComplete="off"
                />
                <input
                  type="password"
                  value={signingSecret}
                  onChange={(e) => setSigningSecret(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Signing Secret"
                  autoComplete="off"
                />
                <button
                  onClick={() => connect.mutate()}
                  disabled={!botToken.trim() || !signingSecret.trim() || connect.isPending}
                  className="w-full rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
                >
                  {connect.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {connect.isPending ? "Connecting…" : "Connect Slack"}
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
