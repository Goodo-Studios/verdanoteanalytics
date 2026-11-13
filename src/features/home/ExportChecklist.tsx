// OS-023: the export checklist in the task side panel. Shown only when the os_settings switch
// export_checklist_replaces_statuses is on (it is off until the editors agree). Staff tick, add and
// remove items; clients never reach this panel and the row rules hide the items from them.
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useTaskChecklist } from "@/hooks/useExportChecklist";

export function ExportChecklist({ taskId, readOnly }: { taskId: string; readOnly: boolean }) {
  const { items, start, toggle, add, remove } = useTaskChecklist(taskId, true);
  const [label, setLabel] = useState("");
  const list = items.data ?? [];
  const failed = items.isError || start.isError || toggle.isError || add.isError || remove.isError;

  if (items.isLoading) return <p className="text-sm text-muted-foreground">Loading checklist…</p>;

  return (
    <div className="space-y-2" data-testid="export-checklist">
      {list.length === 0 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">No export checklist yet.</p>
          {readOnly ? null : (
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-sm hover:bg-secondary"
              onClick={() => start.mutate()}
              disabled={start.isPending}
            >
              Start the export checklist
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-1 text-sm">
          {list.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={readOnly || toggle.isPending}
                  onChange={(e) => toggle.mutate({ id: item.id, done: e.target.checked })}
                />
                <span className={item.done ? "text-muted-foreground line-through" : undefined}>{item.label}</span>
              </label>
              {readOnly ? null : (
                <button
                  type="button"
                  aria-label={`Remove ${item.label}`}
                  className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
                  onClick={() => remove.mutate(item.id)}
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {readOnly ? null : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = label.trim();
            if (!v) return;
            add.mutate(v, { onSuccess: () => setLabel("") });
          }}
        >
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={120}
            placeholder="Add an item"
            aria-label="New checklist item"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
          <button type="submit" className="rounded-md border border-border px-2 py-1 text-sm hover:bg-secondary">
            Add
          </button>
        </form>
      )}
      {failed ? <p className="text-sm text-[var(--gos-late)]">The checklist could not be saved. Try again.</p> : null}
    </div>
  );
}
