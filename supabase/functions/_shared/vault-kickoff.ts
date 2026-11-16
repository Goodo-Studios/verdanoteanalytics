// Durable hand-off between Vault functions (audit plan item 4.4).
//
// A fire-and-forget fetch inside EdgeRuntime.waitUntil can be dropped when the isolate is frozen
// after the response, leaving the item in a processing state with nothing running. This waits a
// short window for the next step to accept the call. A refusal or failure inside the window marks
// the item as an error so the page stops spinning and the user can Re-analyze. A call still in
// flight after the window is handed to waitUntil: by then the next step owns the item's status,
// and fail_stuck_vault_items() (cron) catches anything that still never finishes.

export interface VaultKickoffOptions {
  supabaseUrl: string;
  serviceRoleKey: string;
  itemId: string;
  /** The next function to call, e.g. "vault-transcribe" or "vault-analyze". */
  step: string;
  body?: Record<string, unknown>;
  ackTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Keeps a still-running call alive after the handler returns (EdgeRuntime.waitUntil). */
  keepAlive?: (p: Promise<unknown>) => void;
}

interface UpdateClient {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
}

export const DEFAULT_KICKOFF_ACK_MS = 8_000;

export async function kickOffVaultStep(db: UpdateClient, opts: VaultKickoffOptions): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const markFailed = async (reason: string) => {
    console.error(`vault kick-off to ${opts.step} failed for item ${opts.itemId}:`, reason);
    const { error } = await db
      .from("inspiration_items")
      .update({ status: "error", error_message: `Could not start ${opts.step}: ${reason}`.slice(0, 500) })
      .eq("id", opts.itemId);
    if (error) console.error("vault kick-off: failed to mark item errored:", error);
  };

  const call = (async () => {
    try {
      const res = await doFetch(`${opts.supabaseUrl}/functions/v1/${opts.step}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.serviceRoleKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(opts.body ?? { item_id: opts.itemId }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        await markFailed(`${opts.step} responded ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
      }
    } catch (e) {
      await markFailed(e instanceof Error ? e.message : String(e));
    }
  })();

  const TIMED_OUT = Symbol("kickoff-ack-timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    call,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), opts.ackTimeoutMs ?? DEFAULT_KICKOFF_ACK_MS);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  if (settled === TIMED_OUT) {
    const keep = opts.keepAlive ??
      ((p: Promise<unknown>) => (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(p));
    keep(call);
  }
}
