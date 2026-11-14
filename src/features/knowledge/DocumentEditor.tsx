// The document editor shared by Knowledge and the Brain. Documents are stored as markdown, so
// the editor is a plain text box with a small toolbar (headings, bold, italic, bullet list, link)
// that writes the markdown for the person, and a Preview tab that shows the result. No editor
// library: one textarea keeps it dependable and the stored text stays the same text the Brain
// search, "ask the Brain" and the publish script already read.
//
// The parent saves: onSave gets the text and returns an error message, or null when it was saved.
import { useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { insertLink, setHeading, toggleBullets, wrapSelection, type Edit } from "@/lib/markdownEdit";

export function DocumentEditor({
  initialText,
  label = "Document text",
  onSave,
  onCancel,
}: {
  initialText: string;
  label?: string;
  /** Returns an error message, or null when it was saved. */
  onSave: (text: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);

  // Put the selection back after a toolbar edit re-renders the textarea.
  useLayoutEffect(() => {
    const sel = pendingSelection.current;
    if (!sel || !area.current) return;
    pendingSelection.current = null;
    area.current.focus();
    area.current.setSelectionRange(sel.start, sel.end);
  }, [text]);

  const selection = () => ({ start: area.current?.selectionStart ?? text.length, end: area.current?.selectionEnd ?? text.length });
  const apply = (make: (start: number, end: number) => Edit | null) => {
    const { start, end } = selection();
    const edit = make(start, end);
    if (!edit) return false;
    pendingSelection.current = { start: edit.start, end: edit.end };
    setText(edit.text);
    return true;
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    const e = await onSave(text);
    setBusy(false);
    if (e) setError(e);
  };

  const addLink = () => {
    const ok = apply((s, e) => insertLink(text, s, e, url));
    if (!ok) return setError("Enter a web address, for example https://example.com.");
    setError(null);
    setUrl("");
    setLinkOpen(false);
  };

  const tools: Array<{ name: string; label: string; run: () => void }> = [
    { name: "Heading", label: "H1", run: () => apply((s, e) => setHeading(text, s, e, 1)) },
    { name: "Subheading", label: "H2", run: () => apply((s, e) => setHeading(text, s, e, 2)) },
    { name: "Bold", label: "B", run: () => apply((s, e) => wrapSelection(text, s, e, "**", "bold text")) },
    { name: "Italic", label: "I", run: () => apply((s, e) => wrapSelection(text, s, e, "_", "italic text")) },
    { name: "Bullet list", label: "List", run: () => apply((s, e) => toggleBullets(text, s, e)) },
    { name: "Link", label: "Link", run: () => setLinkOpen((o) => !o) },
  ];
  const changed = text !== initialText;

  return (
    <div className="space-y-2" data-testid="document-editor">
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Formatting">
        {tools.map((t) => (
          <Button key={t.name} type="button" size="sm" variant="outline" aria-label={t.name} title={t.name} disabled={tab === "preview"} onClick={t.run}>
            {t.label}
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <Button type="button" size="sm" variant={tab === "write" ? "secondary" : "ghost"} aria-pressed={tab === "write"} onClick={() => setTab("write")}>Write</Button>
        <Button type="button" size="sm" variant={tab === "preview" ? "secondary" : "ghost"} aria-pressed={tab === "preview"} onClick={() => setTab("preview")}>Preview</Button>
      </div>
      {linkOpen && tab === "write" ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Link address"
            className="h-9 min-w-[16rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }}
          />
          <Button type="button" size="sm" onClick={addLink}>Add link</Button>
        </div>
      ) : null}
      {tab === "write" ? (
        <textarea
          ref={area}
          aria-label={label}
          className="min-h-[260px] w-full rounded-md border border-input bg-background p-3 font-mono text-sm leading-relaxed"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <div className="prose min-h-[260px] rounded-md border border-input p-3" data-testid="document-editor-preview">
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !changed || !text.trim()} onClick={() => void save()}>Save</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
