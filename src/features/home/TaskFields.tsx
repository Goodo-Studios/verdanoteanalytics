// The ClickUp information of a task, shown and edited in the task modal (TaskSidePanel).
//   Brief          the ClickUp description (markdown), or the app's own brief for a task made here.
//   Details        due date, start date, priority, strategist, producer, editor, plus what ClickUp
//                  only reports: its assignees, tags, creator, creation date, time estimate, list.
//   ClickUp fields every custom field of the task (os_tasks.clickup_fields): text, link, number,
//                  date, drop-down and checkbox fields are edited; the rest are shown.
// Each field has its own Save button and says "Saved" or shows the error. A read-only task (an
// ended client) shows the same values with no inputs. Edits of a ClickUp task are queued for
// write-back by the database; that is off until it is switched on, so they are saved in the app
// only (docs/staging.md, OS-017).
import { useEffect, useState } from "react";
import { fmtDateTime } from "@/components/page-kit";
import type { TaskDetail } from "@/hooks/useMyWork";
import { useSetTaskField, useStaffPeople, useUpdateTask } from "@/hooks/useTaskEdit";
import {
  briefOf,
  briefUpdate,
  formatEstimate,
  isEditableField,
  isWebLink,
  PRIORITY_CHOICES,
  personText,
  toFieldEntries,
  type FieldEntry,
} from "@/lib/taskFields";

type Input = "text" | "textarea" | "number" | "date" | "select" | "checkbox" | "url" | "email";

interface EditorProps {
  label: string;
  testId: string;
  value: string;
  input: Input;
  options?: Array<{ value: string; label: string }>;
  /** No inputs: the value is shown as text. */
  readOnly: boolean;
  onSave: (value: string) => Promise<void>;
}

const fieldClass = "w-full rounded-md border border-border bg-card px-2 py-1 text-sm";

/** One editable value with its Save button and its own saved / error message. */
function FieldEditor({ label, testId, value, input, options, readOnly, onSave }: EditorProps) {
  const [draft, setDraft] = useState(value);
  // The value last saved or loaded: the Save button shows only while the draft differs from it.
  const [base, setBase] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setDraft(value);
    setBase(value);
  }, [value]);

  if (readOnly) {
    const shown = input === "select" ? options?.find((o) => o.value === value)?.label ?? value : value;
    return (
      <div className="grid gap-1 sm:grid-cols-[10rem_1fr]" data-testid={testId}>
        <span className="text-sm text-muted-foreground">{label}</span>
        {isWebLink(shown) ? (
          <a href={shown} target="_blank" rel="noopener noreferrer" className="break-all text-sm underline">{shown}</a>
        ) : (
          <span className="whitespace-pre-wrap break-words text-sm">
            {input === "checkbox" ? (value === "true" ? "Yes" : "No") : shown || <span className="text-muted-foreground">Empty</span>}
          </span>
        )}
      </div>
    );
  }

  const dirty = draft !== base;
  const inputId = `${testId}-input`;
  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(draft);
      setBase(draft);
      setSaved(true);
    } catch (e) {
      setError(`Could not save ${label.toLowerCase()}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const change = (next: string) => {
    setDraft(next);
    setSaved(false);
    setError(null);
  };

  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr]" data-testid={testId}>
      <label htmlFor={inputId} className="pt-1 text-sm text-muted-foreground">{label}</label>
      <div className="space-y-1">
        <div className="flex items-start gap-2">
          {input === "textarea" ? (
            <textarea id={inputId} className={`${fieldClass} min-h-[7rem]`} value={draft} onChange={(e) => change(e.target.value)} disabled={busy} />
          ) : input === "select" ? (
            <select id={inputId} className={fieldClass} value={draft} onChange={(e) => change(e.target.value)} disabled={busy}>
              <option value="">None</option>
              {draft && !options?.some((o) => o.value === draft) ? <option value={draft}>{draft}</option> : null}
              {(options ?? []).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : input === "checkbox" ? (
            <input id={inputId} type="checkbox" className="mt-1.5 h-4 w-4" checked={draft === "true"} onChange={(e) => change(e.target.checked ? "true" : "false")} disabled={busy} />
          ) : (
            <input id={inputId} type={input} step={input === "number" ? "any" : undefined} className={fieldClass} value={draft} onChange={(e) => change(e.target.value)} disabled={busy} />
          )}
          {dirty || busy ? (
            <button
              type="button"
              className="shrink-0 rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
              onClick={() => void save()}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          ) : null}
        </div>
        {saved && !dirty ? <p className="text-xs text-muted-foreground" role="status">Saved</p> : null}
        {error ? <p className="text-sm text-[var(--gos-late)]" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}

function Plain({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr]" data-testid={testId}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="break-words text-sm">{children}</span>
    </div>
  );
}

const inputFor = (f: FieldEntry): Input => {
  switch (f.type) {
    case "text":
      return "textarea";
    case "number":
    case "currency":
      return "number";
    case "date":
      return "date";
    case "drop_down":
      return "select";
    case "checkbox":
      return "checkbox";
    case "url":
      return "url";
    case "email":
      return "email";
    default:
      return "text";
  }
};

/** The brief: ClickUp's description for a ClickUp task, the app's brief otherwise. */
export function BriefEditor({ taskId, detail, readOnly }: { taskId: string; detail: TaskDetail | null; readOnly: boolean }) {
  const update = useUpdateTask();
  const clickup = !!detail?.clickup_task_id;
  const text = briefOf(detail);
  if (readOnly) {
    return text ? (
      <p className="whitespace-pre-wrap break-words text-sm">{text}</p>
    ) : (
      <p className="text-sm text-muted-foreground">No brief yet.</p>
    );
  }
  return (
    <FieldEditor
      label="Brief"
      testId="task-panel-brief-editor"
      value={text}
      input="textarea"
      readOnly={false}
      onSave={(v) => update.mutateAsync({ id: taskId, values: briefUpdate(clickup, v) })}
    />
  );
}

/** Due date, start date, priority and the three roles, then the facts only ClickUp reports. */
export function TaskDetails({ taskId, detail, readOnly, fallbackDue }: { taskId: string; detail: TaskDetail | null; readOnly: boolean; fallbackDue: string | null }) {
  const update = useUpdateTask();
  const staff = useStaffPeople(!readOnly);
  if (!detail) return null;
  const people = (staff.data ?? []).map((p) => ({ value: p.user_id, label: p.name }));
  const nameOf = (id: string | null | undefined) => people.find((p) => p.value === id)?.label ?? (id ? "Unknown person" : "");
  const save = (column: string) => (v: string) => update.mutateAsync({ id: taskId, values: { [column]: v || null } });
  const due = (detail.due_date ?? fallbackDue ?? "").slice(0, 10);
  const estimate = formatEstimate(detail.time_estimate_ms);
  const assignees = (detail.assignees ?? []).map(personText).filter(Boolean).join(", ");
  const tags = (detail.clickup_tags ?? []).join(", ");

  const role = (label: string, column: "strategist_id" | "producer_id" | "editor_id", testId: string) => {
    const id = detail[column] ?? "";
    return readOnly ? (
      <Plain label={label} testId={testId}>{nameOf(id) || <span className="text-muted-foreground">Nobody</span>}</Plain>
    ) : (
      <FieldEditor label={label} testId={testId} value={id} input="select" options={people} readOnly={false} onSave={save(column)} />
    );
  };

  return (
    <div className="space-y-2">
      <FieldEditor label="Due date" testId="task-field-due" value={due} input="date" readOnly={readOnly} onSave={save("due_date")} />
      <FieldEditor label="Start date" testId="task-field-start" value={(detail.start_date ?? "").slice(0, 10)} input="date" readOnly={readOnly} onSave={save("start_date")} />
      <FieldEditor label="Priority" testId="task-field-priority" value={detail.priority ?? ""} input="select" options={PRIORITY_CHOICES.map((p) => ({ ...p }))} readOnly={readOnly} onSave={save("priority")} />
      {role("Strategist", "strategist_id", "task-field-strategist")}
      {role("Producer", "producer_id", "task-field-producer")}
      {role("Editor", "editor_id", "task-field-editor")}
      {assignees ? <Plain label="ClickUp assignees" testId="task-field-assignees">{assignees}</Plain> : null}
      {tags ? <Plain label="Tags" testId="task-field-tags">{tags}</Plain> : null}
      {detail.clickup_list_name ? <Plain label="ClickUp list" testId="task-field-list">{detail.clickup_list_name}</Plain> : null}
      {detail.raw_status ? <Plain label="ClickUp status" testId="task-field-raw-status">{detail.raw_status}</Plain> : null}
      {personText(detail.clickup_creator) ? <Plain label="Created by" testId="task-field-creator">{personText(detail.clickup_creator)}</Plain> : null}
      {detail.clickup_created_at ? <Plain label="Created" testId="task-field-created">{fmtDateTime(detail.clickup_created_at)}</Plain> : null}
      {estimate ? <Plain label="Time estimate" testId="task-field-estimate">{estimate}</Plain> : null}
    </div>
  );
}

/** Every ClickUp custom field: editable types get an input, the others are shown as text. */
export function CustomFields({ taskId, detail, readOnly }: { taskId: string; detail: TaskDetail | null; readOnly: boolean }) {
  const setField = useSetTaskField();
  const fields = toFieldEntries(detail?.clickup_fields);
  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">No ClickUp fields stored for this task yet. They arrive with the next ClickUp sync.</p>;
  }
  return (
    <div className="space-y-2">
      {fields.map((f) => {
        const testId = `task-cf-${f.id}`;
        if (!isEditableField(f.type)) {
          return (
            <Plain key={f.id} label={f.name} testId={testId}>
              {f.display ?? <span className="text-muted-foreground">Empty</span>}
            </Plain>
          );
        }
        return (
          <FieldEditor
            key={f.id}
            label={f.name}
            testId={testId}
            value={f.display ?? (f.type === "checkbox" ? "false" : "")}
            input={inputFor(f)}
            options={(f.options ?? []).map((o) => ({ value: o.name, label: o.name }))}
            readOnly={readOnly}
            onSave={(v) => setField.mutateAsync({ id: taskId, fieldId: f.id, value: v })}
          />
        );
      })}
    </div>
  );
}
