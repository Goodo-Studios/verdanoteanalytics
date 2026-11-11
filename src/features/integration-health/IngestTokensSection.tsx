// Client progress feed on Integration health (P9). Builders create and revoke the ingest tokens the
// HQ processes use to push client progress to Verdanote. The raw token is shown exactly once, right
// after it is made, with a copy button; it is kept only in this component's state and is gone when the
// builder dismisses the panel or leaves the page. Nothing else stores it: the database keeps a hash.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ConfirmDialog, EmptyState, StatusBadge, TextField } from "@/components/page-kit";
import { Button } from "@/components/ui/button";
import { fmtWhen } from "@/lib/formatters";
import { auditOutcomeLabel, secretNameFor, type IngestAuditRow, type IngestToken, tokenState } from "./ingestModel";

type Rpc = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> };
const db = supabase as unknown as Rpc;

interface Props {
  isBuilder: boolean;
  environment: string;
}

export function IngestTokensSection({ isBuilder, environment }: Props) {
  const [tokens, setTokens] = useState<IngestToken[] | null>(null);
  const [audit, setAudit] = useState<IngestAuditRow[]>([]);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<IngestToken | null>(null);

  const load = useCallback(async () => {
    const [t, a] = await Promise.all([db.rpc("list_ingest_tokens"), db.rpc("list_ingest_audit", { p_limit: 10 })]);
    if (t.error) return setError("The token list could not be loaded.");
    setTokens(Array.isArray(t.data) ? (t.data as IngestToken[]) : []);
    setAudit(Array.isArray(a.data) ? (a.data as IngestAuditRow[]) : []);
  }, []);

  useEffect(() => {
    if (isBuilder) void load();
  }, [isBuilder, load]);
  // The raw token never outlives the page.
  useEffect(() => () => setFresh(null), []);

  if (!isBuilder) return null;
  const secretName = secretNameFor(environment);

  const create = async () => {
    setError(null);
    const { data, error: e } = await db.rpc("create_ingest_token", { p_name: name.trim(), p_scope: "client_progress" });
    if (e) {
      return setError(e.code === "42501" ? "Only a builder can create a token." : e.code === "54000" ? "There are 20 active tokens. Revoke one first." : e.code === "22023" ? "Give the token a name of 1 to 80 characters." : "The token could not be created.");
    }
    const made = data as { name?: string; token?: string } | null;
    if (!made?.token) return setError("The token could not be created.");
    setFresh({ name: made.name ?? name.trim(), token: made.token });
    setCopied(false);
    setName("");
    void load();
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.token);
      setCopied(true);
    } catch {
      setError("Copying was blocked by the browser. Select the token and copy it by hand.");
    }
  };

  const revoke = async (t: IngestToken) => {
    setRevoking(null);
    const { error: e } = await db.rpc("revoke_ingest_token", { p_id: t.id });
    if (e && e.code !== "P0002") return setError("The token could not be revoked.");
    void load();
  };

  return (
    <section aria-labelledby="ih-progress-feed" className="space-y-3" data-testid="ingest-tokens-section">
      <h2 id="ih-progress-feed" className="text-base font-semibold">Client progress feed</h2>
      <p className="text-sm text-muted-foreground">
        The HQ processes send client progress here with an ingest token. A token is a password for that one job. It is not a login and has no role.
        Store a new token in the HQ vault as <code>{secretName}</code>, then switch the old one off.
      </p>

      {fresh ? (
        <div role="alert" className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm" data-testid="ingest-token-once">
          <p className="font-medium">Copy this token now. It is shown once and cannot be shown again.</p>
          <p>Token name: {fresh.name}</p>
          <input readOnly aria-label="New ingest token" value={fresh.token} onFocus={(e) => e.currentTarget.select()} className="w-full rounded border border-input bg-background p-2 font-mono text-xs" />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void copy()}>{copied ? "Copied" : "Copy token"}</Button>
            <Button size="sm" variant="outline" onClick={() => setFresh(null)}>I have stored it</Button>
          </div>
          <p className="text-muted-foreground">Store it with <code>hq secrets</code> under <code>{secretName}</code>. Do not paste it into chat, a file or a ticket.</p>
        </div>
      ) : null}

      <div role="group" aria-label="Create a token" className="flex flex-wrap items-end gap-2">
        <div className="w-64">
          <TextField label="Token name" hideLabel placeholder="Token name, for example hq-processes" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button size="sm" disabled={name.trim().length === 0} onClick={() => void create()}>Create token</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      {tokens && tokens.length === 0 ? (
        <EmptyState title="No tokens yet." description="Create one, store it in the vault, and the HQ processes can send progress." />
      ) : (
        <ul className="space-y-2 text-sm" aria-label="Ingest tokens">
          {(tokens ?? []).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-input p-3" data-testid={`ingest-token-${t.name}`}>
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-muted-foreground">Created {fmtWhen(t.created_at)} · {t.last_used_at ? `last used ${fmtWhen(t.last_used_at)}` : "never used"}{t.revoked_at ? ` · revoked ${fmtWhen(t.revoked_at)}` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={tokenState(t) === "active" ? "done" : "draft"} label={tokenState(t) === "active" ? "Active" : "Revoked"} />
                {tokenState(t) === "active" ? <Button size="sm" variant="outline" onClick={() => setRevoking(t)}>Revoke</Button> : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3 className="text-sm font-semibold">Latest calls</h3>
      {audit.length === 0 ? (
        <p className="text-sm text-muted-foreground">No calls yet.</p>
      ) : (
        <ul className="space-y-1 text-sm" aria-label="Recent ingest calls">
          {audit.map((a) => (
            <li key={a.id} className="rounded border border-input p-2">
              {fmtWhen(a.called_at)} · {a.source ?? "unknown process"} · {auditOutcomeLabel(a)} · {a.applied_count} of {a.client_count} clients applied, {a.deliverable_count} deliverables
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => { if (!o) setRevoking(null); }}
        title="Revoke this token?"
        description={`Anything using "${revoking?.name ?? ""}" is refused straight away. This cannot be undone; make a new token to restore the feed.`}
        actionLabel="Revoke"
        onConfirm={() => { if (revoking) void revoke(revoking); }}
      />
    </section>
  );
}
