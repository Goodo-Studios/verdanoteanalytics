import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Push a brief to ClickUp (replaces the removed Coda buttons). Staff only: the
// callers render the button for builders and employees, and the server function
// refuses everyone else. The picker offers the client's empty asset tasks
// ("assigned" or "brief creation") or a new asset task.

export interface ClickUpCreativeRef {
  ad_id: string;
  ad_name?: string | null;
}

interface PickerTask {
  id: string;
  name: string;
  status: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heading: string;
  accountId: string | null | undefined;
  initialTitle: string;
  initialBody: string;
  creative?: ClickUpCreativeRef | null;
  /** Runs before the push (the brief editor saves unsaved edits here). */
  beforePush?: () => Promise<void>;
}

const FN = "push-brief-to-clickup";
export const NEW_TASK = "new";

interface ErrorInfo {
  message: string;
  /** Set when the client has no (single) ClickUp folder linked: the client whose Setup tab fixes it. */
  setupSlug: string | null;
}

async function errorInfo(error: unknown, fallback: string): Promise<ErrorInfo> {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (body && typeof body.error === "string") {
        const setupSlug = body.needs_setup === true && typeof body.client_slug === "string" ? body.client_slug : null;
        return { message: body.error, setupSlug };
      }
    } catch {
      // not JSON
    }
  }
  return { message: error instanceof Error && error.message ? error.message : fallback, setupSlug: null };
}

export function PushToClickUpDialog({
  open, onOpenChange, heading, accountId, initialTitle, initialBody, creative, beforePush,
}: Props) {
  const [tasks, setTasks] = useState<PickerTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<string>(NEW_TASK);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupSlug, setSetupSlug] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; task_name: string; note?: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(initialTitle);
    setBody(initialBody);
    setTarget(NEW_TASK);
    setTasks([]);
    setError(null);
    setSetupSlug(null);
    setResult(null);
    if (!accountId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error: invokeError } = await supabase.functions.invoke(FN, {
        body: { action: "list", account_id: accountId },
      });
      if (cancelled) return;
      if (invokeError) {
        const info = await errorInfo(invokeError, "Could not load ClickUp tasks");
        if (cancelled) return;
        setError(info.message);
        setSetupSlug(info.setupSlug);
      } else setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // initialTitle / initialBody are read once per opening on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId]);

  const push = async () => {
    if (!accountId) return;
    setPushing(true);
    setError(null);
    setSetupSlug(null);
    try {
      if (beforePush) await beforePush();
      const { data, error: invokeError } = await supabase.functions.invoke(FN, {
        body: {
          action: "push",
          account_id: accountId,
          target,
          title,
          body,
          ...(creative ? { creative: { ad_id: creative.ad_id, ad_name: creative.ad_name ?? null } } : {}),
        },
      });
      if (invokeError) throw invokeError;
      setResult({ url: data.url, task_name: data.task_name, note: typeof data.note === "string" ? data.note : undefined });
    } catch (err) {
      const info = await errorInfo(err, "Push to ClickUp failed");
      setError(info.message);
      setSetupSlug(info.setupSlug);
    } finally {
      setPushing(false);
    }
  };

  const canPush = !!accountId && !pushing && !loading && body.trim() !== "" && (target !== NEW_TASK || title.trim() !== "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card rounded-lg shadow-modal">
        <DialogHeader>
          <DialogTitle className="font-label text-[14px] font-semibold text-foreground">{heading}</DialogTitle>
          <DialogDescription className="font-body text-[12px] text-muted-foreground">
            Writes the brief into an empty asset task, or a new one, and sets it to brief creation.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 mt-2">
            <p className="font-body text-[13px] text-foreground">Brief pushed to ClickUp.</p>
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-body text-[13px] text-verdant underline"
            >
              <ExternalLink className="h-3.5 w-3.5" /> {result.task_name}
            </a>
            {result.note ? <p className="font-body text-[12px] text-muted-foreground" data-testid="push-note">{result.note}</p> : null}
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            {!accountId && (
              <p className="font-body text-[12px] text-destructive">Select an ad account linked to a client first.</p>
            )}
            <div className="space-y-1.5">
              <label htmlFor="clickup-target" className="font-body text-[12px] font-medium text-foreground">ClickUp task</label>
              <select
                id="clickup-target"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={loading || !accountId}
                className="w-full h-9 px-2 rounded-md border border-input bg-background font-body text-[13px]"
              >
                <option value={NEW_TASK}>New asset task</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>{`${t.name} (${t.status})`}</option>
                ))}
              </select>
              {loading && <p className="font-body text-[11px] text-muted-foreground">Loading empty asset tasks…</p>}
            </div>
            {target === NEW_TASK && (
              <div className="space-y-1.5">
                <label htmlFor="clickup-title" className="font-body text-[12px] font-medium text-foreground">Short title</label>
                <input
                  id="clickup-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Sleep anxiety hook variation"
                  className="w-full h-9 px-3 rounded-md border border-input bg-background font-body text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="clickup-body" className="font-body text-[12px] font-medium text-foreground">Brief</label>
              <Textarea id="clickup-body" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[120px] font-body text-[13px]" />
            </div>
            {error && (
              <p role="alert" className="font-body text-[12px] text-destructive">
                {error}
                {setupSlug && (
                  <>
                    {" "}
                    <a href={`/builder/clients/${encodeURIComponent(setupSlug)}/setup`} className="underline">Open the Setup tab</a>
                  </>
                )}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={pushing}>Cancel</Button>
              <Button size="sm" onClick={push} disabled={!canPush} className="gap-1.5">
                {pushing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Push to ClickUp
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
