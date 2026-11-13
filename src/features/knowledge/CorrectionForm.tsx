// The correction form shared by Knowledge (propose a correction) and the Brain (suggest a fix,
// OS-016). The person edits the text on screen, says why and picks the kind of correction; the
// parent sends it to its checked database function and returns an error message or null.
import { useEffect, useState } from "react";
import { SelectField, TextField, TextareaField } from "@/components/page-kit";
import { Button } from "@/components/ui/button";
import { CLASS_LABEL, type CorrectionClass } from "./model";

export interface CorrectionInput {
  text: string;
  reason: string;
  classification: CorrectionClass;
}

export function CorrectionForm({
  heading,
  initialText,
  submitLabel = "Send for review",
  sentMessage,
  onSubmit,
  onCancel,
}: {
  heading: string;
  initialText: string;
  submitLabel?: string;
  sentMessage: string;
  /** Returns an error message, or null when it was saved. */
  onSubmit: (input: CorrectionInput) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(initialText);
  const [reason, setReason] = useState("");
  const [classification, setClassification] = useState<CorrectionClass>("content");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(initialText), [initialText]);

  const submit = async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    const e = await onSubmit({ text: draft, reason: reason.trim(), classification });
    setBusy(false);
    if (e) return setError(e);
    setReason("");
    setMessage(sentMessage);
  };

  return (
    <div className="space-y-2" data-testid="correction-form">
      <h3 className="text-sm font-semibold">{heading}</h3>
      <TextareaField label="Corrected text" hideLabel inputClassName="min-h-[100px]" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField label="Why" hideLabel placeholder="Why it needs correcting" value={reason} onChange={(e) => setReason(e.target.value)} />
        <SelectField
          label="Kind of correction"
          hideLabel
          value={classification}
          onChange={(e) => setClassification(e.target.value as CorrectionClass)}
          options={(Object.keys(CLASS_LABEL) as CorrectionClass[]).map((k) => ({ value: k, label: CLASS_LABEL[k] }))}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !reason.trim() || !draft.trim() || draft === initialText} onClick={() => void submit()}>{submitLabel}</Button>
        {onCancel ? <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button> : null}
      </div>
      {message ? <p role="status" className="text-sm">{message}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
