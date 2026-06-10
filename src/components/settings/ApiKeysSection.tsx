import { useState } from "react";
import { Key, Plus, Copy, Trash2, Eye, EyeOff, CheckCircle2, XCircle, Clock, Shield, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useApiKeys, useCreateApiKey, useRevokeApiKey, useDeleteApiKey } from "@/hooks/useApiKeysApi";
import { ConfirmDeleteDialog } from "@/components/user-settings/ConfirmDeleteDialog";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

const AVAILABLE_SCOPES = [
  { value: "read", label: "Read", desc: "List creatives, accounts, metrics" },
  { value: "write", label: "Write", desc: "Update creative tags and notes" },
  { value: "sync", label: "Sync", desc: "Trigger data syncs via API" },
];

export function ApiKeysSection() {
  const { isBuilder } = useAuth();
  const { data: keys = [], isLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const deleteKey = useDeleteApiKey();

  const [newKeyName, setNewKeyName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["read"]);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [showDocs, setShowDocs] = useState(false);

  // Defense-in-depth: only builders can access API keys
  if (!isBuilder) return null;

  const handleCreate = async () => {
    if (!newKeyName.trim() || selectedScopes.length === 0) return;
    try {
      const key = await createKey.mutateAsync({ name: newKeyName.trim(), scopes: selectedScopes });
      setRevealedKey(key);
      setShowKey(true);
      setNewKeyName("");
      setSelectedScopes(["read"]);
      toast.success("API key created — copy it now, it won't be shown again");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create API key");
    }
  };

  const toggleScope = (scope: string) => {
    setSelectedScopes(prev =>
      prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
    );
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-[18px] text-foreground font-semibold mb-1">API Access</h2>
        <p className="font-body text-[13px] text-muted-foreground">
          Create API keys to access Verdanote data programmatically from Slack, Notion, spreadsheets, and more.
        </p>
      </div>

      {/* Create new key */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-4">
        <p className="font-body text-[14px] text-foreground font-medium">Create New Key</p>
        <div className="flex gap-2">
          <Input
            placeholder="Key name (e.g. Slack Bot, Notion Sync)"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            maxLength={100}
            className="flex-1"
          />
        </div>

        {/* Scope selector */}
        <div className="space-y-2">
          <p className="font-label text-[11px] uppercase tracking-wider text-muted-foreground">Scopes</p>
          <div className="flex flex-wrap gap-4">
            {AVAILABLE_SCOPES.map(scope => (
              <label key={scope.value} className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  checked={selectedScopes.includes(scope.value)}
                  onCheckedChange={() => toggleScope(scope.value)}
                  className="mt-0.5"
                />
                <div>
                  <span className="font-body text-[13px] text-foreground font-medium">{scope.label}</span>
                  <p className="font-body text-[11px] text-muted-foreground">{scope.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <Button
          onClick={handleCreate}
          disabled={!newKeyName.trim() || selectedScopes.length === 0 || createKey.isPending}
          className="gap-1.5"
          size="sm"
        >
          <Plus className="h-4 w-4" />
          {createKey.isPending ? "Creating..." : "Create API Key"}
        </Button>
      </div>

      {/* Revealed key banner */}
      {revealedKey && (
        <div className="border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-600 shrink-0" />
            <p className="font-body text-[13px] text-amber-800 dark:text-amber-200 font-medium">
              Save this key — you won't see it again.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="font-mono text-[12px] text-amber-900 dark:text-amber-100 bg-white dark:bg-amber-950 border border-amber-200 dark:border-amber-700 px-3 py-2 rounded flex-1 truncate">
              {showKey ? revealedKey : "•".repeat(revealedKey.length)}
            </code>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0" onClick={() => setShowKey(v => !v)}>
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0" onClick={() => handleCopy(revealedKey)}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="text-[11px] text-amber-700 dark:text-amber-300 h-auto p-0" onClick={() => setRevealedKey(null)}>
            I've saved my key, dismiss
          </Button>
        </div>
      )}

      {/* Keys list */}
      <div className="space-y-2">
        <p className="font-body text-[13px] text-foreground font-medium">
          Your Keys {keys.length > 0 && <span className="text-muted-foreground font-normal">({keys.length})</span>}
        </p>
        {isLoading && (
          <div className="py-8 text-center font-body text-[13px] text-muted-foreground">Loading keys…</div>
        )}
        {!isLoading && keys.length === 0 && (
          <div className="py-8 text-center flex flex-col items-center gap-2">
            <Key className="h-8 w-8 text-muted-foreground" />
            <p className="font-body text-[13px] text-muted-foreground">No API keys yet. Create one above.</p>
          </div>
        )}
        {keys.map((key) => (
          <div
            key={key.id}
            className={`flex items-center gap-3 p-3 rounded-lg border ${key.is_active ? "border-border bg-card" : "border-border/50 bg-muted/30 opacity-60"}`}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {key.is_active
                ? <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                : <XCircle className="h-4 w-4 text-destructive shrink-0" />}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-body text-[13px] text-foreground font-medium truncate">{key.name}</span>
                  {!key.is_active && (
                    <span className="font-label text-[10px] text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">Revoked</span>
                  )}
                  {/* Scope badges */}
                  {key.permissions?.map(p => (
                    <span key={p} className="font-label text-[9px] uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                      {p}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  <code className="font-mono text-[11px] text-muted-foreground">{key.key_prefix}…</code>
                  {key.last_used_at ? (
                    <span className="font-body text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Used {formatDistanceToNow(new Date(key.last_used_at), { addSuffix: true })}
                    </span>
                  ) : (
                    <span className="font-body text-[11px] text-muted-foreground">Never used</span>
                  )}
                  <span className="font-body text-[11px] text-muted-foreground">
                    Created {format(new Date(key.created_at), "MMM d, yyyy")}
                  </span>
                  {key.expires_at && (
                    <span className={`font-body text-[11px] ${new Date(key.expires_at) < new Date() ? "text-destructive" : "text-muted-foreground"}`}>
                      {new Date(key.expires_at) < new Date() ? "Expired" : `Expires ${format(new Date(key.expires_at), "MMM d")}`}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {key.is_active && (
                <Button
                  size="sm" variant="ghost"
                  className="h-7 text-[11px] text-muted-foreground hover:text-amber-700"
                  onClick={() => setConfirmRevoke(key.id)}
                >
                  Revoke
                </Button>
              )}
              <Button
                size="sm" variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmDelete(key.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* API Documentation */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => setShowDocs(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted/80 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <Code2 className="h-4 w-4 text-primary" />
            <span className="font-body text-[13px] text-foreground font-medium">API Documentation & Examples</span>
          </div>
          <span className="font-body text-[11px] text-muted-foreground">{showDocs ? "Hide" : "Show"}</span>
        </button>

        {showDocs && (
          <div className="p-4 space-y-4 bg-card">
            {/* Base URL */}
            <div className="space-y-1">
              <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Base URL</p>
              <div className="flex items-center gap-2">
                <code className="font-mono text-[12px] text-foreground bg-muted px-3 py-1.5 rounded border border-border flex-1 truncate">
                  {baseUrl}
                </code>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0" onClick={() => handleCopy(baseUrl)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Endpoints */}
            <div className="space-y-1">
              <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Endpoints</p>
              <div className="grid grid-cols-1 gap-1">
                {[
                  ["GET /creatives", "List creatives (params: account_id, limit, offset, min_roas, status)"],
                  ["GET /creatives/:id", "Get a specific creative by ad_id"],
                  ["GET /accounts", "List all ad accounts"],
                  ["GET /metrics", "Aggregated performance metrics (params: account_id)"],
                  ["GET /summary", "Account summary with metrics (params: account_id — required)"],
                  ["POST /sync", "Trigger a sync (requires 'sync' scope, body: { account_id })"],
                ].map(([endpoint, desc]) => (
                  <div key={endpoint} className="flex items-start gap-3 py-1">
                    <code className="font-mono text-[11px] text-primary bg-primary/5 px-2 py-0.5 rounded shrink-0">{endpoint}</code>
                    <span className="font-body text-[11px] text-muted-foreground">{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Authentication */}
            <div className="space-y-1">
              <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Authentication</p>
              <p className="font-body text-[11px] text-muted-foreground">
                Pass your key via header: <code className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded border border-border">x-api-key: vdn_...</code> or{" "}
                <code className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded border border-border">Authorization: Bearer vdn_...</code>
              </p>
            </div>

            {/* Curl Examples */}
            <div className="space-y-2">
              <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">curl Examples</p>

              {[
                {
                  title: "Get all creatives for an account",
                  cmd: `curl -s "${baseUrl}/creatives?account_id=YOUR_ACCOUNT_ID&limit=50" \\\n  -H "x-api-key: YOUR_API_KEY"`,
                },
                {
                  title: "Get creatives with ROAS > 2.0",
                  cmd: `curl -s "${baseUrl}/creatives?account_id=YOUR_ACCOUNT_ID&min_roas=2.0" \\\n  -H "x-api-key: YOUR_API_KEY"`,
                },
                {
                  title: "Get account summary",
                  cmd: `curl -s "${baseUrl}/summary?account_id=YOUR_ACCOUNT_ID" \\\n  -H "x-api-key: YOUR_API_KEY"`,
                },
                {
                  title: "Trigger a sync",
                  cmd: `curl -s -X POST "${baseUrl}/sync" \\\n  -H "x-api-key: YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"account_id":"YOUR_ACCOUNT_ID"}'`,
                },
              ].map(({ title, cmd }) => (
                <div key={title} className="space-y-1">
                  <p className="font-body text-[11px] text-foreground font-medium"># {title}</p>
                  <div className="relative">
                    <pre className="font-mono text-[11px] text-muted-foreground bg-muted border border-border rounded p-3 overflow-x-auto whitespace-pre-wrap">
                      {cmd}
                    </pre>
                    <Button
                      size="sm" variant="ghost"
                      className="absolute top-1 right-1 h-6 w-6 p-0"
                      onClick={() => handleCopy(cmd)}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Rate limiting note */}
            <div className="bg-muted/50 border border-border rounded p-3">
              <p className="font-body text-[11px] text-muted-foreground">
                <strong className="text-foreground">Rate Limit:</strong> 100 requests per minute per API key. Exceeding this returns HTTP 429.
              </p>
            </div>
          </div>
        )}
      </div>

      <ConfirmDeleteDialog
        open={!!confirmRevoke}
        onOpenChange={() => setConfirmRevoke(null)}
        title="Revoke API Key"
        description="This will immediately disable this key. Any integrations using it will stop working."
        actionLabel="Revoke Key"
        onConfirm={() => { if (confirmRevoke) revokeKey.mutate(confirmRevoke); setConfirmRevoke(null); }}
      />

      <ConfirmDeleteDialog
        open={!!confirmDelete}
        onOpenChange={() => setConfirmDelete(null)}
        title="Delete API Key"
        description="This will permanently delete this key record. This cannot be undone."
        actionLabel="Delete Key"
        onConfirm={() => { if (confirmDelete) deleteKey.mutate(confirmDelete); setConfirmDelete(null); }}
      />
    </div>
  );
}
